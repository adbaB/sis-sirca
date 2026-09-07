import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractsService } from '../services/contracts.service';
import { Invoice, InvoiceStatus } from '../../billing/invoices/entities/invoice.entity';
import { Payment, PaymentStatus } from '../../billing/payments/entities/payment.entity';
import { getCaracasNow } from '../../common/utils/date.util';

export interface ReactivatedContractInfo {
  contractCode: string;
  titularName: string;
  reactivationDate: string;
}

@Injectable()
export class ContractReactivationCron {
  private readonly logger = new Logger(ContractReactivationCron.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    private readonly contractsService: ContractsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Se ejecuta diariamente a las 2:00 AM (America/Caracas).
   * Evalúa todos los contratos en SUSPENDED cuya fecha de elegibilidad
   * (reactivation_eligible_at) ya se haya alcanzado (<= now).
   *
   * Si el contrato está 100% solvente y sus pagos están formalmente COMPLETED,
   * se reactiva a ACTIVE automáticamente.
   */
  @Cron('0 2 * * *')
  async processContractReactivations(): Promise<void> {
    this.logger.log('Iniciando proceso diario de reactivación de contratos suspendidos...');

    const chunkSize = 100;
    let lastId: string | null = null;
    const reactivatedContracts: ReactivatedContractInfo[] = [];
    const now = getCaracasNow();
    const nowDate = now.toJSDate();
    const todayStr = now.toFormat('dd/MM/yyyy');

    while (true) {
      // Búsqueda en lotes aprovechando el índice condicional (status, reactivation_eligible_at)
      const contracts = await this.contractRepository.find({
        where: {
          status: ContractStatus.SUSPENDED,
          reactivationEligibleAt: LessThanOrEqual(nowDate),
          ...(lastId ? { id: MoreThan(lastId) } : {}),
        },
        relations: ['contractPersons', 'contractPersons.person'],
        order: { id: 'ASC' },
        take: chunkSize,
      });

      if (contracts.length === 0) {
        break;
      }

      for (const contract of contracts) {
        const result = await this.evaluateAndReactivate(contract, todayStr, nowDate);
        if (result) {
          reactivatedContracts.push(result);
        }
      }

      lastId = contracts[contracts.length - 1].id;
    }

    this.logger.log(
      `Proceso de reactivación de contratos completado. ${reactivatedContracts.length} contrato(s) reactivado(s) automáticamente.`,
    );
  }

  private async evaluateAndReactivate(
    contract: Contract,
    todayStr: string,
    nowDate: Date,
  ): Promise<ReactivatedContractInfo | null> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // 1. Verificar si existen facturas vencidas impagas
      const overdueInvoiceCount = await queryRunner.manager.count(Invoice, {
        where: {
          contract: { id: contract.id },
          status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
          dueDate: LessThanOrEqual(nowDate),
        },
      });

      // 2. Verificar si existen pagos pendientes en PROCESSING
      const processingPaymentCount = await queryRunner.manager
        .createQueryBuilder(Payment, 'p')
        .innerJoin('p.invoice', 'inv')
        .where('inv.contract_id = :contractId', { contractId: contract.id })
        .andWhere('p.status = :status', { status: PaymentStatus.PROCESSING })
        .andWhere('p.deleted_at IS NULL')
        .getCount();

      // Si aún hay pagos en PROCESSING, el plazo expiró pero administración no ha aprobado el pago
      if (processingPaymentCount > 0) {
        await queryRunner.rollbackTransaction();
        this.logger.warn(
          `Contrato ${contract.code} cumplió los 7 días de carencia pero tiene ${processingPaymentCount} pago(s) en PROCESSING pendiente(s) de aprobación.`,
        );
        return null;
      }

      // Si tiene deuda y no hay pagos en PROCESSING, perdió la solvencia (ej. pago rechazado)
      if (overdueInvoiceCount > 0) {
        await queryRunner.manager.update(Contract, contract.id, {
          reactivationEligibleAt: null,
        });
        await queryRunner.commitTransaction();
        this.logger.warn(
          `Contrato ${contract.code} cumplió fecha pero mantiene ${overdueInvoiceCount} factura(s) vencida(s) impagas. Se resetea reactivation_eligible_at.`,
        );
        return null;
      }

      await queryRunner.commitTransaction();

      // 3. Reactivar el contrato mediante el servicio de ciclo de vida
      await this.contractsService.activate(contract.id);

      const titularCp = contract.contractPersons?.find((cp) => cp.isBillingOwner === true);
      const titularName = titularCp?.person?.name ?? 'Sin titular';

      this.logger.log(
        `Contrato ${contract.code} (${titularName}) reactivado exitosamente tras cumplir 7 días de carencia.`,
      );

      return {
        contractCode: contract.code,
        titularName,
        reactivationDate: todayStr,
      };
    } catch (error: unknown) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error(
        `Error al evaluar reactivación para el contrato ${contract.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    } finally {
      await queryRunner.release();
    }
  }
}
