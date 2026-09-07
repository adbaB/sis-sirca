import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, In, LessThanOrEqual, Repository } from 'typeorm';
import { Advisor } from '../../advisors/entities/advisor.entity';
import { resolveQueryRunner } from '../../common/context/request-context';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { CARACAS_ZONE, formatDateES, getCaracasNow } from '../../common/utils/date.util';
import { Portfolio } from '../../portfolios/entities/portfolio.entity';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ActivateContractDto } from '../dto/activate-contract.dto';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';
import { PersonStatus } from '../../persons/entities/person.entity';
import { Invoice, InvoiceStatus } from '../../billing/invoices/entities/invoice.entity';
import { PaymentStatus } from '../../billing/payments/entities/payment.entity';
import { Role } from '../../roles/entities/role.entity';
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
    const em = manager ?? this.dataSource.manager;
    const contractRepo = em.getRepository(Contract);

    const contract = await contractRepo.findOne({
      where: { id: contractId },
    });

    if (!contract || contract.status !== ContractStatus.SUSPENDED) {
      return null;
    }

    const now = getCaracasNow();
    const nowDate = now.toJSDate();

    // 1. Obtener todas las facturas del contrato ordenadas por fecha de vencimiento
    const invoices = await em.find(Invoice, {
      where: { contract: { id: contractId } },
      relations: ['payments'],
      order: { dueDate: 'DESC' },
    });

    if (!invoices || invoices.length === 0) {
      contract.reactivationEligibleAt = null;
      await contractRepo.save(contract);
      return null;
    }

    // Facturas vencidas que no están completamente pagadas (PENDING o PARTIAL con dueDate <= nowDate)
    const overdueInvoices = invoices.filter(
      (inv) =>
        (inv.status === InvoiceStatus.PENDING || inv.status === InvoiceStatus.PARTIAL) &&
        inv.dueDate &&
        new Date(inv.dueDate) <= nowDate,
    );

    // Calcular deuda vencida pendiente vs pagos en PROCESSING
    let totalOverdueRemaining = 0;
    let totalProcessingOnOverdue = 0;

    for (const inv of overdueInvoices) {
      const totalAmount = Number(inv.totalAmount);
      const retentionAmount = Number(inv.retentionAmount || 0);
      const paidAmount = Number(inv.paidAmount || 0);
      const amountDue = Math.max(0, totalAmount - retentionAmount - paidAmount);
      totalOverdueRemaining += amountDue;

      const processingPayments = (inv.payments || []).filter(
        (p) => p.status === PaymentStatus.PROCESSING && !p.deletedAt,
      );
      for (const p of processingPayments) {
        totalProcessingOnOverdue += Number(p.amount);
      }
    }

    // ¿La deuda vencida está cubierta por pagos COMPLETED o PROCESSING?
    const isCovered =
      overdueInvoices.length === 0 || totalProcessingOnOverdue >= totalOverdueRemaining;

    if (!isCovered) {
      contract.reactivationEligibleAt = null;
      await contractRepo.save(contract);
      return null;
    }

    // Buscar el operationDate más reciente entre los pagos activos (COMPLETED o PROCESSING)
    let latestOperationDate: Date | null = null;
    for (const inv of invoices) {
      for (const p of inv.payments || []) {
        if (
          (p.status === PaymentStatus.COMPLETED || p.status === PaymentStatus.PROCESSING) &&
          !p.deletedAt
        ) {
          const dateVal = p.operationDate ?? p.paymentDate;
          if (dateVal) {
            const d = new Date(dateVal);
            if (!latestOperationDate || d > latestOperationDate) {
              latestOperationDate = d;
            }
          }
        }
      }
    }

    if (!latestOperationDate) {
      contract.reactivationEligibleAt = null;
      await contractRepo.save(contract);
      return null;
    }

    // 7 días corridos a partir del operation_date
    const eligibleAt = DateTime.fromJSDate(latestOperationDate)
      .setZone(CARACAS_ZONE)
      .plus({ days: 7 })
      .toJSDate();

    contract.reactivationEligibleAt = eligibleAt;
    await contractRepo.save(contract);
    return eligibleAt;
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

    // Verificar si el usuario cuenta con el permiso de excepción override:contract-reactivation
    let hasOverridePermission = false;
    if (user?.roleId) {
      const roleRepo = manager.getRepository(Role);
      const role = await roleRepo.findOne({
        where: { id: user.roleId },
        relations: ['permissions'],
      });
      if (role && role.permissions) {
        hasOverridePermission = role.permissions.some(
          (p) => p.name === 'override:contract-reactivation',
        );
      }
    }

    // Validar reglas si el contrato proviene de SUSPENDED
    if (lockedContract.status === ContractStatus.SUSPENDED) {
      const now = getCaracasNow();
      const nowDate = now.toJSDate();

      // Verificar facturas vencidas impagas (status PENDING o PARTIAL con dueDate <= nowDate)
      const invoiceRepo = manager.getRepository(Invoice);
      const overdueUnpaidCount = await invoiceRepo.count({
        where: {
          contract: { id: contractId },
          status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
          dueDate: LessThanOrEqual(nowDate),
        },
      });

      const hasDebt = overdueUnpaidCount > 0;
      const isCooldownActive =
        !lockedContract.reactivationEligibleAt ||
        new Date(lockedContract.reactivationEligibleAt) > nowDate;

      const isBypassNeeded = hasDebt || isCooldownActive;

      if (isBypassNeeded) {
        if (!hasOverridePermission) {
          if (hasDebt) {
            throw new BadRequestException(
              `El contrato tiene ${overdueUnpaidCount} factura(s) vencida(s) pendiente(s). Debe estar solvente para ser reactivado.`,
            );
          }
          if (isCooldownActive) {
            const formattedDate = lockedContract.reactivationEligibleAt
              ? formatDateES(
                  DateTime.fromJSDate(new Date(lockedContract.reactivationEligibleAt)).setZone(
                    CARACAS_ZONE,
                  ),
                  'dd/MM/yyyy',
                )
              : 'fecha por definir tras reporte de pago';
            throw new BadRequestException(
              `El contrato se encuentra en período de carencia post-suspensión. Podrá ser reactivado a partir del ${formattedDate}.`,
            );
          }
        }

        // Si tiene permiso de override (Bypass), el motivo (reason) es estrictamente OBLIGATORIO
        if (!dto?.reason || !dto.reason.trim()) {
          throw new BadRequestException(
            'Se requiere especificar un motivo (reason) para ejecutar la reactivación por excepción médica/administrativa.',
          );
        }

        this.logger.warn(
          `Bypass de reactivación ejecutado para contrato ${lockedContract.code} por usuario ${user?.userId ?? 'sistema'}. Motivo: ${dto.reason.trim()}`,
        );
      }
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
