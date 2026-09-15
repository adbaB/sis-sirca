import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Advisor } from '../../advisors/entities/advisor.entity';
import { resolveQueryRunner } from '../../common/context/request-context';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { CARACAS_ZONE, getCaracasNow } from '../../common/utils/date.util';
import { Portfolio } from '../../portfolios/entities/portfolio.entity';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ActivateContractDto } from '../dto/activate-contract.dto';
import { RenewContractDto } from '../dto/renew-contract.dto';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractAffiliationService } from './contract-affiliation.service';
import { ContractReactivationService } from './contract-reactivation.service';
import { calculateContractExpirationDate } from '../helpers/contract-date-formatter.helper';
import { AffiliationAction } from '../enums/affiliation-action.enum';
import { PersonStatus } from '../../persons/entities/person.entity';
import type { JwtPayload } from '../../auth/guards/auth.guard';

@Injectable()
export class ContractLifecycleService {
  private readonly logger = new Logger(ContractLifecycleService.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contractsRepository: Repository<Contract>,
    @InjectRepository(ContractPerson)
    private readonly contractPersonsRepository: Repository<ContractPerson>,
    @InjectRepository(AffiliationHistory)
    private readonly affiliationHistoryRepository: Repository<AffiliationHistory>,
    private readonly dataSource: DataSource,
    private readonly reactivationService: ContractReactivationService,
    private readonly affiliationService: ContractAffiliationService,
  ) {}

  /**
   * Retrieves a contract by its ID with all essential relations.
   */
  async findOne(id: string): Promise<Contract> {
    const contract = await this.contractsRepository.findOne({
      where: { id },
      relations: [
        'contractPersons',
        'contractPersons.plan',
        'contractPersons.person',
        'contractPersons.person.plan',
        'contractPersons.healthDeclarations',
        'invoices',
        'invoices.payments',
        'surpluses',
        'surpluses.payment',
        'advisor',
        'portfolio',
      ],
    });
    if (!contract) {
      throw new NotFoundException(`Contract with ID "${id}" not found`);
    }
    return contract;
  }

  /**
   * Retrieves a contract by its official or legacy code.
   */
  async findByCode(code: string): Promise<Contract | null> {
    const trimmed = code.trim();
    return this.contractsRepository.findOne({
      where: [{ code: trimmed }, { legacyCode: trimmed }],
      relations: [
        'contractPersons',
        'contractPersons.plan',
        'contractPersons.person',
        'contractPersons.person.plan',
        'contractPersons.healthDeclarations',
        'invoices',
        'invoices.payments',
        'surpluses',
        'surpluses.payment',
        'advisor',
        'portfolio',
      ],
    });
  }

  /**
   * Updates basic contract properties (retention percentage, advisor, portfolio, dates).
   */
  async update(id: string, updateContractDto: UpdateContractDto): Promise<Contract> {
    const contract = await this.findOne(id);
    const { advisorId, portfolioId, startDate, expirationDate, ...rest } = updateContractDto;

    Object.assign(contract, rest);

    if (startDate !== undefined) {
      contract.startDate = startDate ? new Date(startDate) : null;
    }

    if (expirationDate !== undefined) {
      contract.expirationDate = expirationDate ? new Date(expirationDate) : null;
    }

    if (
      contract.startDate &&
      contract.expirationDate &&
      contract.expirationDate < contract.startDate
    ) {
      throw new BadRequestException(
        'La fecha de vencimiento no puede ser anterior a la fecha de inicio.',
      );
    }

    if (advisorId !== undefined) {
      contract.advisor = advisorId ? ({ id: advisorId } as Advisor) : null;
    }

    if (portfolioId !== undefined) {
      contract.portfolio = portfolioId ? ({ id: portfolioId } as Portfolio) : null;
    }

    return this.contractsRepository.save(contract);
  }

  /**
   * Renews a contract with a new start date and expiration date without modifying affiliationDate (original creation date).
   */
  @Transactional()
  async renew(id: string, dto: RenewContractDto): Promise<Contract> {
    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;
    const contractRepo = manager.getRepository(Contract);
    const cpRepo = manager.getRepository(ContractPerson);

    // 1. Lock contract row for update without relations to prevent:
    // "ERROR: FOR UPDATE cannot be applied to the nullable side of an outer join" in PostgreSQL
    const contract = await contractRepo.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!contract) {
      throw new NotFoundException(`El contrato con ID "${id}" no fue encontrado.`);
    }

    const newStartDate = dto.startDate;
    const newExpirationDate = dto.expirationDate
      ? dto.expirationDate
      : calculateContractExpirationDate(newStartDate);

    if (newExpirationDate < newStartDate) {
      throw new BadRequestException(
        'La fecha de vencimiento no puede ser anterior a la fecha de inicio.',
      );
    }

    contract.startDate = new Date(newStartDate);
    contract.expirationDate = new Date(newExpirationDate);

    // If contract was INACTIVE or SUSPENDED, reactivate to ACTIVE upon renewal
    if (contract.status !== ContractStatus.ACTIVE) {
      contract.status = ContractStatus.ACTIVE;
      contract.inactivationReason = null;
      contract.reactivationEligibleAt = null;
    }

    await contractRepo.save(contract);

    // Update patient / affiliate data if provided
    const affiliatesToUpdate = dto.beneficiaries || dto.affiliates || [];
    for (const item of affiliatesToUpdate) {
      let targetCpId = item.contractPersonId || item.id;
      if (!targetCpId && item.identityCard && item.typeIdentityCard) {
        const foundCp = await cpRepo.findOne({
          where: {
            contract: { id },
            person: { identityCard: item.identityCard, typeIdentityCard: item.typeIdentityCard },
          },
          relations: ['person'],
        });
        if (foundCp) {
          targetCpId = foundCp.id;
        }
      }

      if (targetCpId) {
        await this.affiliationService.updateBeneficiary(id, targetCpId, item, manager);
      }
    }

    if (affiliatesToUpdate.length > 0) {
      await this.affiliationService.recalculateMonthlyAmount(id, manager);
    }

    this.logger.log(
      `Contract ${contract.code} renewed: startDate=${newStartDate}, expirationDate=${newExpirationDate}`,
    );

    return (await contractRepo.findOne({
      where: { id },
      relations: [
        'contractPersons',
        'contractPersons.plan',
        'contractPersons.person',
        'contractPersons.person.plan',
        'contractPersons.healthDeclarations',
        'advisor',
        'portfolio',
      ],
    })) as Contract;
  }

  /**
   * Soft-removes a contract by setting deletedAt timestamp.
   */
  async remove(id: string): Promise<void> {
    const contract = await this.findOne(id);
    await this.contractsRepository.softRemove(contract);
  }

  /**
   * Inactivates an active contract atomically, records DESAFILIACION for active AFILIADOS.
   */
  @Transactional()
  async inactivate(contractId: string, dto: InactivateContractDto): Promise<Contract> {
    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;

    const contractRepo = manager.getRepository(Contract);
    const cpRepo = manager.getRepository(ContractPerson);
    const historyRepo = manager.getRepository(AffiliationHistory);

    // Lock contract for update to guarantee idempotency and avoid race conditions
    const lockedContract = await contractRepo.findOne({
      where: { id: contractId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!lockedContract) {
      throw new NotFoundException(`El contrato con ID "${contractId}" no fue encontrado.`);
    }

    if (lockedContract.status === ContractStatus.INACTIVE) {
      throw new BadRequestException('El contrato ya se encuentra inactivo.');
    }

    // Update contract status and reason
    lockedContract.status = ContractStatus.INACTIVE;
    lockedContract.inactivationReason = dto.reason;
    await contractRepo.save(lockedContract);

    // Record DESAFILIACION for each active person (only AFILIADOs with status ACTIVE)
    const activePersons = await cpRepo.find({
      where: {
        contract: { id: contractId },
        role: PersonRole.AFILIADO,
        person: { status: PersonStatus.ACTIVE },
      },
      relations: ['person', 'person.plan', 'plan'],
    });

    const truncatedReason = dto.reason ? dto.reason.substring(0, 255) : null;

    for (const cp of activePersons) {
      const effectivePlan = cp.plan ?? cp.person?.plan ?? null;
      await historyRepo.save(
        historyRepo.create({
          contract: lockedContract,
          person: cp.person,
          plan: effectivePlan,
          action: AffiliationAction.DESAFILIACION,
          amount: Number(effectivePlan?.amount ?? 0),
          reason: truncatedReason,
        }),
      );
    }

    return lockedContract;
  }

  /**
   * Sincroniza la fecha de elegibilidad de reactivación (reactivation_eligible_at)
   * para contratos en estado SUSPENDED según sus facturas vencidas y pagos activos (COMPLETED o PROCESSING).
   */
  async syncReactivationEligibility(
    contractId: string,
    manager?: EntityManager,
  ): Promise<Date | null> {
    return this.reactivationService.syncReactivationEligibility(contractId, manager);
  }

  /**
   * Reactivates an inactive or suspended contract.
   * - If SUSPENDED: validates 7-day cooldown from operation_date and total solvency,
   *   or verifies override permission for manual bypass with required reason.
   * - If INACTIVE: handles disaffiliation reconciliation and audit history.
   */
  @Transactional()
  async activate(
    contractId: string,
    dto?: ActivateContractDto,
    user?: JwtPayload,
  ): Promise<Contract> {
    const qr = resolveQueryRunner(undefined, this.dataSource);
    const manager = qr.manager;

    const contractRepo = manager.getRepository(Contract);
    const historyRepo = manager.getRepository(AffiliationHistory);

    const lockedContract = await contractRepo.findOne({
      where: { id: contractId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!lockedContract) {
      throw new NotFoundException(`El contrato con ID "${contractId}" no fue encontrado.`);
    }

    if (lockedContract.status === ContractStatus.ACTIVE) {
      throw new BadRequestException('El contrato ya se encuentra activo.');
    }

    // Validar reglas si el contrato proviene de SUSPENDED (solvencia, carencia de 7 días, o bypass con motivo)
    if (lockedContract.status === ContractStatus.SUSPENDED) {
      await this.reactivationService.validateReactivationEligibility(
        lockedContract,
        dto,
        user,
        manager,
      );
    }

    const previousStatus = lockedContract.status;
    lockedContract.status = ContractStatus.ACTIVE;
    lockedContract.inactivationReason = null;
    lockedContract.reactivationEligibleAt = null;
    await contractRepo.save(lockedContract);

    // Solo si el contrato venía de INACTIVE ejecutamos la reconciliación de desafiliaciones
    if (previousStatus === ContractStatus.INACTIVE) {
      const disaffiliations = await historyRepo.find({
        where: {
          contract: { id: contractId },
          action: AffiliationAction.DESAFILIACION,
          isReverted: false,
        },
      });

      const caracasNow = getCaracasNow();
      const currentYear = caracasNow.year;
      const currentMonth = caracasNow.month;

      const sameMonthRecords = disaffiliations.filter((h) => {
        const dateVal = h.actionDate ?? h.createdAt;
        const dt = DateTime.fromJSDate(new Date(dateVal)).setZone(CARACAS_ZONE);
        return dt.year === currentYear && dt.month === currentMonth;
      });

      if (sameMonthRecords.length > 0) {
        // Reversión dentro del mismo mes: se anulan las desafiliaciones del período actual
        for (const record of sameMonthRecords) {
          record.isReverted = true;
          record.revertedAt = caracasNow.toJSDate();
        }
        await historyRepo.save(sameMonthRecords);
      } else {
        // Reactivación en un mes posterior (ej. desafiliado en mes 9 y reactivado en mes 10):
        // NO se revierte la desafiliación del mes 9 (se mantiene el histórico cerrado).
        // En cambio, cuenta como una AFILIACION en el mes actual para cada beneficiario activo.
        const cpRepo = manager.getRepository(ContractPerson);
        const activePersons = await cpRepo.find({
          where: {
            contract: { id: contractId },
            role: PersonRole.AFILIADO,
            person: { status: PersonStatus.ACTIVE },
          },
          relations: ['person', 'person.plan', 'plan'],
        });

        if (activePersons.length > 0) {
          const newAffiliations = activePersons.map((cp) => {
            const effectivePlan = cp.plan ?? cp.person?.plan ?? null;
            return historyRepo.create({
              contract: lockedContract,
              person: cp.person,
              plan: effectivePlan,
              action: AffiliationAction.AFILIACION,
              amount: Number(effectivePlan?.amount ?? 0),
              reason: 'Reactivación de contrato',
              actionDate: caracasNow.toJSDate(),
            });
          });
          await historyRepo.save(newAffiliations);
        }
      }
    }

    return lockedContract;
  }

  /**
   * Assigns or detaches an advisor from an existing contract.
   */
  async setAdvisor(contractId: string, advisorId: string | null): Promise<void> {
    await this.contractsRepository.save({
      id: contractId,
      advisor: advisorId ? ({ id: advisorId } as Advisor) : null,
    });
  }
}
