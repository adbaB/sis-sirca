import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, QueryRunner, Repository } from 'typeorm';
import { getCaracasTodayJSDate } from '../../../common/utils/date.util';
import { Contract, ContractStatus } from '../../../contracts/entities/contract.entity';
import { ExchangeRate } from '../../../exchange-rate/entities/Exchange-rate.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Surplus, SurplusStatus, isValidSurplusTransition } from '../entities/surplus.entity';
import { Invoice, InvoiceStatus } from '../../invoices/entities/invoice.entity';
import { InvoiceCalculationService } from '../../invoices/services/invoice-calculation.service';
import { INVOICE_CREATED, InvoiceCreatedEvent } from '../../invoices/events/invoice.events';
import {
  getQueryRunner,
  getQueryRunnerSafe,
  requestContextStorage,
} from '../../../common/context/request-context';
import { Transactional } from '../../../common/decorators/transactional.decorator';
import { calculateSurplusApplication } from '../utils/surplus-calculator.util';
import { UpdateSurplusStatusDto } from '../dto/update-surplus-status.dto';

/**
 * Servicio encargado de gestionar los saldos a favor / excedentes de pago de los contratos.
 * Se encarga de aplicar automáticamente excedentes pendientes a facturas recién creadas o activas,
 * escuchar eventos del sistema y persistir registros de saldo a favor.
 */
@Injectable()
export class SurplusService {
  private readonly logger = new Logger(SurplusService.name);

  constructor(
    @InjectRepository(Surplus)
    private readonly surplusRepository: Repository<Surplus>,
    private readonly dataSource: DataSource,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly invoiceCalculationService: InvoiceCalculationService,
  ) {}

  /**
   * Aplica los excedentes pendientes (`PENDING`) de un contrato específico a una factura determinada.
   * Ejecutado transaccionalmente con bloqueo pesimista de la factura y de los registros de excedente.
   * Genera registros sintéticos de {@link Payment} por cada porción de excedente imputada.
   *
   * @param contractId - Identificador del contrato titular del saldo a favor.
   * @param invoiceId - Identificador de la factura a la cual se aplicarán los excedentes.
   * @returns Promesa que se resuelve al finalizar el proceso.
   * @throws Error Si la factura especificada no existe o no se encuentra tasa de cambio requerida.
   */
  @Transactional()
  async applyPendingSurplusesToInvoice(contractId: string, invoiceId: string): Promise<void> {
    const queryRunner = getQueryRunner();

    const invoice = await queryRunner.manager
      .createQueryBuilder(Invoice, 'invoice')
      .setQueryRunner(queryRunner)
      .where('invoice.id = :id', { id: invoiceId })
      .setLock('pessimistic_write')
      .getOne();

    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    // Fetch pending surpluses with lock (without relations to prevent PG outer join lock error)
    const surpluses = await queryRunner.manager.find(Surplus, {
      where: {
        contract: { id: contractId },
        status: SurplusStatus.PENDING,
        invoice: IsNull(),
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (!surpluses.length) {
      return;
    }

    // Load relations safely for locked surpluses
    const surplusesWithRelations = await queryRunner.manager.find(Surplus, {
      where: {
        id: In(surpluses.map((s) => s.id)),
      },
      relations: ['payment', 'payment.person', 'contract'],
    });

    const fechaVe = getCaracasTodayJSDate();
    let exchangeRate: ExchangeRate | null = null;
    let remainingBalanceUsd = Math.max(
      0,
      Number(invoice.totalAmount) -
        Number(invoice.retentionAmount || 0) -
        Number(invoice.paidAmount),
    );

    for (const surplus of surplusesWithRelations) {
      if (remainingBalanceUsd <= 0.01) {
        break;
      }

      // Fetch exchange rate lazily if surplus contains Bs amount
      let rateUsd: number | undefined;
      if (surplus.amountBs && surplus.amountBs > 0) {
        if (!exchangeRate) {
          exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);
          if (!exchangeRate) {
            throw new Error('Exchange rate not found for current date to apply Bs surplus');
          }
        }
        rateUsd = Number(exchangeRate.rateUsd);
      }

      const calc = calculateSurplusApplication(
        surplus.amountUsd !== null ? Number(surplus.amountUsd) : null,
        surplus.amountBs !== null ? Number(surplus.amountBs) : null,
        remainingBalanceUsd,
        rateUsd,
      );

      if (calc.amountToApplyUsd > 0) {
        if (calc.hasLeftover) {
          // Create a NEW pending surplus for the remainder
          const remainingSurplus = queryRunner.manager.create(Surplus, {
            amountUsd: calc.leftoverUsd,
            amountBs: calc.leftoverBs,
            date: surplus.date,
            payment: surplus.payment,
            invoice: null,
            contract: surplus.contract,
            status: SurplusStatus.PENDING,
          });
          await queryRunner.manager.save(remainingSurplus);
        }

        // Create a synthetic Payment record applying this surplus segment to the invoice
        const surplusPayment = queryRunner.manager.create(Payment, {
          paymentDate: getCaracasTodayJSDate(),
          status: PaymentStatus.COMPLETED,
          invoice: invoice,
          person: surplus.payment ? surplus.payment.person : null,
          referenceNumber: surplus.payment
            ? `SURPLUS-${surplus.payment.referenceNumber}`
            : `SURPLUS-SYSTEM-${surplus.id ? surplus.id.slice(0, 8) : 'NEW'}`,
          amount: calc.amountToApplyUsd,
          amountBs: calc.amountToApplyBs > 0 ? calc.amountToApplyBs : 0,
          paymentMethod: surplus.payment ? surplus.payment.paymentMethod : 'SURPLUS_AJUSTE',
          url: surplus.payment ? surplus.payment.url : null,
        }) as Payment;

        await queryRunner.manager.save(surplusPayment);

        // Update current surplus to consumed amount and mark APPLIED
        surplus.amountUsd = surplus.amountUsd !== null ? calc.amountToApplyUsd : null;
        surplus.amountBs = surplus.amountBs !== null ? calc.amountToApplyBs : null;
        surplus.status = SurplusStatus.APPLIED;
        surplus.invoice = invoice;
        await queryRunner.manager.save(surplus);

        remainingBalanceUsd -= calc.amountToApplyUsd;

        this.logger.log(
          `Applied surplus ${surplus.id} to invoice ${invoiceId} (applied USD: $${calc.amountToApplyUsd.toFixed(2)})`,
        );
      }
    }

    await this.invoiceCalculationService.recalculateInvoicePaidAmount(
      invoiceId,
      queryRunner.manager,
    );
  }

  /**
   * Manejador de eventos activado cuando se crea una nueva factura (`INVOICE_CREATED`).
   * Intenta aplicar inmediatamente los excedentes pendientes que pueda tener el contrato titular.
   *
   * NOTA: Se usa `requestContextStorage.exit()` para salir del contexto ALS del request
   * HTTP original. Esto es necesario porque `EventEmitter2.emit()` no espera (await) los
   * handlers async — el handler se ejecuta en el event loop DESPUÉS de que ContextInterceptor
   * libere el QueryRunner del request. Sin `exit()`, `@Transactional()` reutilizaría el QR
   * ya liberado y lanzaría "Query runner already released".
   *
   * @param event - Objeto del evento con `contractId` e `invoiceId`.
   */
  @OnEvent(INVOICE_CREATED)
  async handleInvoiceCreated(event: InvoiceCreatedEvent): Promise<void> {
    requestContextStorage.exit(() => {
      this.applyPendingSurplusesToInvoice(event.contractId, event.invoiceId).catch((err) => {
        this.logger.error(
          `[surplus] Error aplicando excedentes para factura ${event.invoiceId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
  }

  /**
   * Proceso masivo que recorre todos los contratos activos e intenta aplicar saldos a favor pendientes
   * a sus facturas más antiguas impagas (`PENDING` o `PARTIAL`).
   */
  async applyPendingSurplusesToAllActiveInvoices(): Promise<void> {
    this.logger.log('Starting bulk pending surplus application...');

    const contracts = await this.dataSource.getRepository(Contract).find({
      where: { status: ContractStatus.ACTIVE },
    });

    this.logger.log(`Found ${contracts.length} active contracts to process.`);

    for (const contract of contracts) {
      const pendingInvoice = await this.dataSource.getRepository(Invoice).findOne({
        where: {
          contract: { id: contract.id },
          status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIAL]),
        },
        order: { billingMonth: 'ASC' },
      });

      if (pendingInvoice) {
        try {
          this.logger.log(
            `Applying pending surpluses to invoice ${pendingInvoice.id} (${pendingInvoice.billingMonth}) for contract ${contract.code}`,
          );
          await this.applyPendingSurplusesToInvoice(contract.id, pendingInvoice.id);
        } catch (error) {
          this.logger.error(
            `Error applying pending surpluses to invoice ${pendingInvoice.id} for contract ${contract.code}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    this.logger.log('Bulk pending surplus application completed.');
  }

  /**
   * Persiste un nuevo registro de excedente/saldo a favor en estado `PENDING`.
   *
   * @param queryRunnerOrNull - Instancia opcional de QueryRunner para ejecuciones en transacción.
   * @param invoice - Factura de origen.
   * @param savedPayment - Pago que generó el sobrepago.
   * @param paymentDate - Fecha asignada al excedente.
   * @param surplusAmountUsd - Monto sobrante en USD (o null si no hay sobrante en USD).
   * @param surplusAmountBs - Monto sobrante en Bs (o null si no hay sobrante en Bs).
   * @returns ID del excedente creado o `null` si no se especificaron montos sobrantes.
   */
  async persistSurplus(
    queryRunnerOrNull: QueryRunner | null,
    invoice: Invoice,
    savedPayment: Payment,
    paymentDate: Date,
    surplusAmountUsd: number | null,
    surplusAmountBs: number | null,
  ): Promise<string | null> {
    if (surplusAmountUsd === null && surplusAmountBs === null) {
      return null;
    }
    const manager =
      queryRunnerOrNull?.manager || getQueryRunnerSafe()?.manager || this.surplusRepository.manager;

    const saved = await manager.save(
      manager.create(Surplus, {
        amountBs: surplusAmountBs,
        amountUsd: surplusAmountUsd,
        date: paymentDate,
        payment: savedPayment,
        invoice: null,
        contract: invoice.contract,
        status: SurplusStatus.PENDING,
      }),
    );
    return saved.id;
  }

  /**
   * Modifica manualmente el estado de un excedente aplicando validación de máquina de estados.
   * Ejecutado transaccionalmente con bloqueo pesimista.
   *
   * @param id - Identificador UUID del excedente a modificar.
   * @param dto - DTO con el nuevo estado (`status`) y el motivo opcional (`reason`).
   * @returns Promesa con la entidad {@link Surplus} actualizada y relaciones cargadas.
   * @throws NotFoundException Si el excedente no existe.
   * @throws BadRequestException Si el excedente ya está aplicado o la transición no es válida.
   */
  @Transactional()
  async updateSurplusStatus(id: string, dto: UpdateSurplusStatusDto): Promise<Surplus> {
    const qr = getQueryRunnerSafe();
    const surplusRepo = qr ? qr.manager.getRepository(Surplus) : this.surplusRepository;

    const surplus = await surplusRepo.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!surplus) {
      throw new NotFoundException(`Excedente con ID ${id} no encontrado`);
    }

    if (surplus.status === SurplusStatus.APPLIED) {
      throw new BadRequestException(
        'No se puede modificar el estado de un excedente que ya ha sido aplicado a una factura.',
      );
    }

    if (dto.status === SurplusStatus.APPLIED) {
      throw new BadRequestException(
        'No se puede asignar manualmente el estado "applied". Los excedentes se aplican al imputarse a facturas.',
      );
    }

    if (!isValidSurplusTransition(surplus.status, dto.status)) {
      throw new BadRequestException(
        `Transición de estado no permitida: no se puede cambiar de "${surplus.status}" a "${dto.status}".`,
      );
    }

    const previousStatus = surplus.status;
    surplus.status = dto.status;

    const currentMetadata = (surplus.metadata as Record<string, unknown>) || {};
    surplus.metadata = {
      ...currentMetadata,
      statusChangeReason: dto.reason?.trim() || null,
      previousStatus,
      lastStatusChangeAt: getCaracasTodayJSDate().toISOString(),
    };

    await surplusRepo.save(surplus);

    const reloaded = await surplusRepo.findOne({
      where: { id },
      relations: ['payment', 'payment.person', 'contract', 'invoice'],
    });

    if (!reloaded) {
      throw new NotFoundException(`Excedente con ID ${id} no encontrado tras actualizar`);
    }

    this.logger.log(
      `Surplus ${id} status updated from ${previousStatus} to ${dto.status}${
        dto.reason ? ` (Reason: ${dto.reason})` : ''
      }`,
    );

    return reloaded;
  }
}
