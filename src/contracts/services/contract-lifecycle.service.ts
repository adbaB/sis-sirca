import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Advisor } from '../../advisors/entities/advisor.entity';
import { resolveQueryRunner } from '../../common/context/request-context';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { Portfolio } from '../../portfolios/entities/portfolio.entity';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';

@Injectable()
export class ContractLifecycleService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractsRepository: Repository<Contract>,
    @InjectRepository(ContractPerson)
    private readonly contractPersonsRepository: Repository<ContractPerson>,
    @InjectRepository(AffiliationHistory)
    private readonly affiliationHistoryRepository: Repository<AffiliationHistory>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Retrieves a contract by its ID with all essential relations.
   */
  async findOne(id: string): Promise<Contract> {
    const contract = await this.contractsRepository.findOne({
      where: { id },
      relations: [
        'contractPersons',
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
   * Updates basic contract properties (retention percentage, advisor, portfolio).
   */
  async update(id: string, updateContractDto: UpdateContractDto): Promise<Contract> {
    const contract = await this.findOne(id);
    const { advisorId, portfolioId, ...rest } = updateContractDto;

    Object.assign(contract, rest);

    if (advisorId !== undefined) {
      contract.advisor = advisorId ? ({ id: advisorId } as Advisor) : null;
    }

    if (portfolioId !== undefined) {
      contract.portfolio = portfolioId ? ({ id: portfolioId } as Portfolio) : null;
    }

    return this.contractsRepository.save(contract);
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
    const contract = await this.findOne(contractId);

    if (contract.status === ContractStatus.INACTIVE) {
      throw new BadRequestException('El contrato ya se encuentra inactivo.');
    }

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

    // Record DESAFILIACION for each active person (only AFILIADOs)
    const activePersons = await cpRepo.find({
      where: {
        contract: { id: contractId },
        role: PersonRole.AFILIADO,
      },
      relations: ['person', 'person.plan'],
    });

    const truncatedReason = dto.reason ? dto.reason.substring(0, 255) : null;

    for (const cp of activePersons) {
      await historyRepo.save(
        historyRepo.create({
          contract: lockedContract,
          person: cp.person,
          plan: cp.person?.plan ?? null,
          action: AffiliationAction.DESAFILIACION,
          amount: Number(cp.person?.plan?.amount ?? 0),
          reason: truncatedReason,
        }),
      );
    }

    return lockedContract;
  }

  /**
   * Reactivates an inactive contract and marks same-month disaffiliation records as reverted.
   * Reverted records are preserved for audit trail but excluded from affiliation statistics.
   */
  @Transactional()
  async activate(contractId: string): Promise<Contract> {
    const contract = await this.findOne(contractId);

    if (contract.status === ContractStatus.ACTIVE) {
      throw new BadRequestException('El contrato ya se encuentra activo.');
    }

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

    lockedContract.status = ContractStatus.ACTIVE;
    lockedContract.inactivationReason = null;
    await contractRepo.save(lockedContract);

    const disaffiliations = await historyRepo.find({
      where: {
        contract: { id: contractId },
        action: AffiliationAction.DESAFILIACION,
      },
    });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const sameMonthRecords = disaffiliations.filter((h) => {
      const date = new Date(h.actionDate ?? h.createdAt);
      return date.getFullYear() === currentYear && date.getMonth() === currentMonth;
    });

    // Mark as reverted instead of hard-deleting to preserve audit trail
    if (sameMonthRecords.length > 0) {
      for (const record of sameMonthRecords) {
        record.reason = `REVERTIDO: ${record.reason ?? 'Contrato reactivado'}`;
      }
      await historyRepo.save(sameMonthRecords);
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
