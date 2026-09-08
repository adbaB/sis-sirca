import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import { CARACAS_ZONE, formatDateES, getCaracasNow } from '../../common/utils/date.util';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { Invoice, InvoiceStatus } from '../../billing/invoices/entities/invoice.entity';
import { PaymentStatus } from '../../billing/payments/entities/payment.entity';
import { evaluateOverdueInvoices } from '../policies/contract-debt-evaluator.policy';
import { hasRolePermission } from '../../roles/helpers/role-permission.helper';
import { OVERRIDE_REACTIVATION_PERMISSION } from '../constants/contract.constants';
import { ActivateContractDto } from '../dto/activate-contract.dto';
import type { JwtPayload } from '../../auth/guards/auth.guard';

@Injectable()
export class ContractReactivationService {
  private readonly logger = new Logger(ContractReactivationService.name);

  constructor(private readonly dataSource: DataSource) {}

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

    const debtEval = evaluateOverdueInvoices(invoices, nowDate);

    if (!debtEval.isCoveredByProcessingOrPaid) {
      contract.reactivationEligibleAt = null;
      await contractRepo.save(contract);
      return null;
    }

    // Buscar el operationDate más reciente entre los pagos activos de las facturas vencidas
    let latestOperationDate: Date | null = null;
    for (const inv of debtEval.overdueInvoices) {
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

    // Si no hay pagos en las facturas vencidas (ej. se saldaron por retención o saldo a favor sin un pago directo),
    // la carencia de 7 días cuenta a partir de la fecha actual en que se regularizó la deuda.
    const baselineDate = latestOperationDate ?? nowDate;

    // 7 días corridos a partir de la fecha base
    const eligibleAt = DateTime.fromJSDate(baselineDate)
      .setZone(CARACAS_ZONE)
      .plus({ days: 7 })
      .toJSDate();

    contract.reactivationEligibleAt = eligibleAt;
    await contractRepo.save(contract);
    return eligibleAt;
  }

  /**
   * Valida solvencia, período de carencia y permisos de excepción (bypass) para reactivar un contrato SUSPENDED.
   */
  async validateReactivationEligibility(
    contract: Contract,
    dto?: ActivateContractDto,
    user?: JwtPayload,
    manager?: EntityManager,
  ): Promise<void> {
    const em = manager ?? this.dataSource.manager;

    // Verificar si el usuario cuenta con el permiso de excepción override:contract-reactivation
    let hasOverridePermission = false;
    if (user?.roleId) {
      hasOverridePermission = await hasRolePermission(
        user.roleId,
        OVERRIDE_REACTIVATION_PERMISSION,
        em,
      );
    }

    const now = getCaracasNow();
    const nowDate = now.toJSDate();

    // Verificar facturas vencidas impagas considerando retenciones y pagos
    const invoiceRepo = em.getRepository(Invoice);
    let overdueInvoices: Invoice[] = [];
    if (typeof invoiceRepo.find === 'function') {
      overdueInvoices = await invoiceRepo.find({
        where: {
          contract: { id: contract.id },
          status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
          dueDate: LessThanOrEqual(nowDate),
        },
        relations: ['payments'],
      });
    } else if (typeof invoiceRepo.count === 'function') {
      const count = await invoiceRepo.count({
        where: {
          contract: { id: contract.id },
          status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
          dueDate: LessThanOrEqual(nowDate),
        },
      });
      if (count > 0) {
        overdueInvoices = Array(count).fill({
          totalAmount: 100,
          paidAmount: 0,
          retentionAmount: 0,
          status: InvoiceStatus.PENDING,
          dueDate: nowDate,
        }) as Invoice[];
      }
    }

    const debtEval = evaluateOverdueInvoices(overdueInvoices, nowDate);
    const hasDebt = debtEval.hasOverdueDebt;
    const isCooldownActive =
      !contract.reactivationEligibleAt || new Date(contract.reactivationEligibleAt) > nowDate;

    const isBypassNeeded = hasDebt || isCooldownActive;

    if (isBypassNeeded) {
      if (!hasOverridePermission) {
        if (hasDebt) {
          throw new BadRequestException(
            `El contrato tiene ${debtEval.overdueInvoicesWithDebt.length} factura(s) vencida(s) pendiente(s). Debe estar solvente para ser reactivado.`,
          );
        }
        if (isCooldownActive) {
          const formattedDate = contract.reactivationEligibleAt
            ? formatDateES(
                DateTime.fromJSDate(new Date(contract.reactivationEligibleAt)).setZone(
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
        `Bypass de reactivación ejecutado para contrato ${contract.code} por usuario ${user?.userId ?? 'sistema'}. Motivo: ${dto.reason.trim()}`,
      );
    }
  }
}
