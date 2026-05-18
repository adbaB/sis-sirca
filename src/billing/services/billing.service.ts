import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DateTime } from 'luxon';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { ExchangeRate } from '../../exchange-rate/entities/Exchange-rate.entity';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Surplus, SurplusStatus } from '../entities/surplus.entity';
import { PaymentRegisteredEvent } from '../events/payment-registered.event';
import { SurplusCreatedEvent } from '../events/surplus-created.event';

interface PaymentSplit {
  paymentAmountUsd: number;
  paymentAmountBs: number;
  surplusAmountUsd: number | null;
  surplusAmountBs: number | null;
}

interface TransactionResult {
  savedPayment: Payment;
  invoice: Invoice;
  surplusId: string | null;
  surplusAmountUsd: number | null;
  surplusAmountBs: number | null;
  paymentDate: Date;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly dataSource: DataSource,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async createPayment(
    createPaymentDto: CreatePaymentDto,
    externalQueryRunner?: QueryRunner,
    deferredEvents?: Array<{ name: string; payload: unknown }>,
  ) {
    const amount = Number(createPaymentDto.amount);
    const amountExtracted = Number(createPaymentDto.amountExtracted);
    this.validateAmounts(createPaymentDto, amount, amountExtracted);

    const queryRunner = externalQueryRunner || this.dataSource.createQueryRunner();
    const { savedPayment, invoice, surplusId, surplusAmountUsd, surplusAmountBs, paymentDate } =
      await this.executePaymentTransaction(
        createPaymentDto,
        amount,
        amountExtracted,
        queryRunner,
        externalQueryRunner,
      );

    const enrichedPayment = await this.reloadPaymentWithRelations(queryRunner, savedPayment.id);
    await this.emitPaymentRegisteredEvent(
      createPaymentDto,
      savedPayment,
      enrichedPayment,
      invoice,
      deferredEvents,
    );
    await this.emitSurplusCreatedEvent(
      savedPayment,
      invoice,
      surplusId,
      surplusAmountUsd,
      surplusAmountBs,
      paymentDate,
      deferredEvents,
    );

    return savedPayment;
  }

  // ---------------------------------------------------------------------------
  // Private helpers — createPayment
  // ---------------------------------------------------------------------------

  /**
   * Executes the database transaction: fetches the invoice, computes amounts,
   * persists the payment and optional surplus, recalculates invoice status,
   * and commits. All mutable state is scoped inside this method and returned
   * as a typed result — eliminating the need for shared mutable variables.
   */
  private async executePaymentTransaction(
    dto: CreatePaymentDto,
    amount: number,
    amountExtracted: number,
    queryRunner: QueryRunner,
    externalQueryRunner: QueryRunner | undefined,
  ): Promise<TransactionResult> {
    if (!externalQueryRunner) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    }

    try {
      const invoice = await this.fetchInvoiceWithLock(queryRunner, dto.invoiceId);
      const exchangeRate = await this.getExchangeRateOrThrow();

      const amountUsd = this.resolveAmountUsd(dto, amount, exchangeRate.rateUsd);
      const invoiceUnpaidAmount = Math.max(
        0,
        Number(invoice.totalAmount) - Number(invoice.paidAmount),
      );

      const split = this.computePaymentSplit(
        amountUsd,
        invoiceUnpaidAmount,
        amountExtracted,
        dto.paymentMethod,
        exchangeRate.rateUsd,
      );

      const paymentDate = new Date();
      const savedPayment = await this.persistPayment(queryRunner, dto, invoice, split, paymentDate);
      const surplusId = await this.persistSurplus(
        queryRunner,
        invoice,
        savedPayment,
        paymentDate,
        split.surplusAmountUsd,
        split.surplusAmountBs,
      );

      // Recalculate invoice inside the transaction so a failure rolls back the payment too.
      await this.recalculateInvoicePaidAmount(dto.invoiceId, queryRunner);

      if (!externalQueryRunner) {
        await queryRunner.commitTransaction();
      }

      return {
        savedPayment,
        invoice,
        surplusId,
        surplusAmountUsd: split.surplusAmountUsd,
        surplusAmountBs: split.surplusAmountBs,
        paymentDate,
      };
    } catch (error) {
      if (!externalQueryRunner) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      if (!externalQueryRunner) {
        await queryRunner.release();
      }
    }
  }

  /** Validates that the incoming amounts are positive finite numbers. */
  private validateAmounts(dto: CreatePaymentDto, amount: number, amountExtracted: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }
    if (dto.paymentMethod !== 'zelle') {
      if (!Number.isFinite(amountExtracted) || amountExtracted <= 0) {
        throw new BadRequestException('Payment amount Bs must be greater than 0');
      }
    }
  }

  /**
   * Fetches the invoice using a pessimistic write lock to prevent race
   * conditions, and throws a NotFoundException when absent.
   */
  private async fetchInvoiceWithLock(
    queryRunner: QueryRunner,
    invoiceId: string,
  ): Promise<Invoice> {
    const invoice = await queryRunner.manager
      .createQueryBuilder(Invoice, 'invoice')
      .setQueryRunner(queryRunner)
      .innerJoinAndSelect('invoice.contract', 'contract')
      .where('invoice.id = :id', { id: invoiceId })
      .setLock('pessimistic_write')
      .getOne();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${invoiceId} not found`);
    }
    return invoice;
  }

  /** Fetches today's exchange rate for Venezuela or throws if unavailable. */
  private async getExchangeRateOrThrow(): Promise<ExchangeRate> {
    const fechaVe = DateTime.now().setZone('America/Caracas').toJSDate();
    const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);
    if (!exchangeRate) {
      throw new BadRequestException('Exchange rate not found for date');
    }
    return exchangeRate;
  }

  /**
   * Converts the raw amount to USD.
   * For non-Zelle methods the extracted Bs amount is divided by the rate.
   */
  private resolveAmountUsd(dto: CreatePaymentDto, amount: number, rateUsd: number): number {
    if (dto.paymentMethod !== 'zelle' && dto.amountExtracted) {
      return dto.amountExtracted / rateUsd;
    }
    return amount;
  }

  /**
   * Determines how much of the payment applies to the invoice vs. becomes
   * surplus, and returns the capped payment amounts.
   */
  private computePaymentSplit(
    amountUsd: number,
    invoiceUnpaidAmount: number,
    amountExtracted: number,
    paymentMethod: string,
    rateUsd: number,
  ): PaymentSplit {
    let paymentAmountUsd = amountUsd;
    let paymentAmountBs = paymentMethod !== 'zelle' ? amountExtracted : 0;
    let surplusAmountUsd: number | null = null;
    let surplusAmountBs: number | null = null;

    if (amountUsd > invoiceUnpaidAmount) {
      const surplusUsd = amountUsd - invoiceUnpaidAmount;

      if (paymentMethod === 'zelle') {
        surplusAmountUsd = surplusUsd;
      } else {
        surplusAmountBs = surplusUsd * rateUsd;
      }

      // Cap the payment to exactly what the invoice needs.
      paymentAmountUsd = invoiceUnpaidAmount;
      paymentAmountBs = paymentMethod !== 'zelle' ? amountExtracted - (surplusAmountBs ?? 0) : 0;
    }

    return { paymentAmountUsd, paymentAmountBs, surplusAmountUsd, surplusAmountBs };
  }

  /** Creates and persists a Payment entity within the active transaction. */
  private async persistPayment(
    queryRunner: QueryRunner,
    dto: CreatePaymentDto,
    invoice: Invoice,
    split: PaymentSplit,
    paymentDate: Date,
  ): Promise<Payment> {
    const payment = queryRunner.manager.create(Payment, {
      paymentDate,
      status: PaymentStatus.PROCESSING,
      invoice,
      person: dto.personId ? { id: dto.personId } : null,
      referenceNumber: dto.referenceNumber,
      amount: split.paymentAmountUsd,
      amountBs: split.paymentAmountBs,
      paymentMethod: dto.paymentMethod,
      url: dto.url,
      metadata: dto.metadata ?? null,
    }) as Payment;

    return queryRunner.manager.save(payment);
  }

  /**
   * Persists a Surplus record when the payment exceeds the invoice balance.
   * Returns the saved surplus ID, or null when no surplus exists.
   */
  private async persistSurplus(
    queryRunner: QueryRunner,
    invoice: Invoice,
    savedPayment: Payment,
    paymentDate: Date,
    surplusAmountUsd: number | null,
    surplusAmountBs: number | null,
  ): Promise<string | null> {
    if (surplusAmountUsd === null && surplusAmountBs === null) {
      return null;
    }
    const saved = await queryRunner.manager.save(
      queryRunner.manager.create(Surplus, {
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
   * Reloads the saved payment with all necessary relations.
   * Swallows errors and returns null so event emission can fall back gracefully.
   */
  private async reloadPaymentWithRelations(
    queryRunner: QueryRunner,
    paymentId: string,
  ): Promise<Payment | null> {
    try {
      const paymentRepo = queryRunner.manager.getRepository(Payment);
      return await paymentRepo.findOne({
        where: { id: paymentId },
        relations: [
          'person',
          'invoice',
          'invoice.contract',
          'invoice.contract.advisor',
          'invoice.details',
          'invoice.details.plan',
        ],
      });
    } catch (reloadError) {
      this.logger.warn(
        `Could not reload payment ${paymentId} with relations, falling back to saved data. ${
          reloadError instanceof Error ? reloadError.message : String(reloadError)
        }`,
      );
      return null;
    }
  }

  /** Derives all display fields from enriched/fallback data and builds the event. */
  private buildPaymentRegisteredEvent(
    dto: CreatePaymentDto,
    savedPayment: Payment,
    enrichedPayment: Payment | null,
    invoice: Invoice,
  ): PaymentRegisteredEvent {
    const contractCode = enrichedPayment?.invoice?.contract?.code || invoice?.contract?.code || '';
    const personName = enrichedPayment?.person?.name || '';
    const datePaymentReceipt = dto.datePaymentReceipt || '';
    const totalInvoice = enrichedPayment?.invoice?.totalAmount ?? invoice?.totalAmount ?? 0;
    const billingMonth = enrichedPayment?.invoice?.billingMonth ?? invoice?.billingMonth ?? '';
    const planNames = [
      ...new Set(
        (enrichedPayment?.invoice?.details ?? []).map((d) => d.plan?.name).filter(Boolean),
      ),
    ].join(', ');
    const advisorName = enrichedPayment?.invoice?.contract?.advisor?.name || '';

    return new PaymentRegisteredEvent(
      savedPayment.referenceNumber,
      savedPayment.amount,
      savedPayment.amountBs,
      savedPayment.url,
      savedPayment.createdAt || new Date(),
      contractCode,
      personName,
      savedPayment.id,
      totalInvoice,
      datePaymentReceipt,
      planNames,
      advisorName,
      billingMonth,
    );
  }

  /**
   * Emits an event immediately or pushes it to the deferred queue.
   * Centralises the repeated `if (deferredEvents) … else emit(…)` pattern.
   */
  private emitOrDefer(
    eventName: string,
    payload: unknown,
    deferredEvents?: Array<{ name: string; payload: unknown }>,
  ): void {
    if (deferredEvents) {
      deferredEvents.push({ name: eventName, payload });
    } else {
      this.eventEmitter.emit(eventName, payload);
    }
  }

  /** Builds and emits/defers the `payment.registered` event. Errors are logged, never rethrown. */
  private async emitPaymentRegisteredEvent(
    dto: CreatePaymentDto,
    savedPayment: Payment,
    enrichedPayment: Payment | null,
    invoice: Invoice,
    deferredEvents?: Array<{ name: string; payload: unknown }>,
  ): Promise<void> {
    try {
      const eventPayload = this.buildPaymentRegisteredEvent(
        dto,
        savedPayment,
        enrichedPayment,
        invoice,
      );
      this.emitOrDefer('payment.registered', eventPayload, deferredEvents);
    } catch (emitError) {
      this.logger.error(
        `Failed to emit payment.registered event for payment ${savedPayment.id}. The payment was saved successfully.`,
        emitError instanceof Error ? emitError.stack : String(emitError),
      );
    }
  }

  /**
   * Builds and emits/defers the `surplus.created` event when a surplus exists.
   * Errors are logged, never rethrown.
   */
  private async emitSurplusCreatedEvent(
    savedPayment: Payment,
    invoice: Invoice,
    surplusId: string | null,
    surplusAmountUsd: number | null,
    surplusAmountBs: number | null,
    paymentDate: Date,
    deferredEvents?: Array<{ name: string; payload: unknown }>,
  ): Promise<void> {
    if ((surplusAmountUsd === null && surplusAmountBs === null) || surplusId === null) {
      return;
    }
    try {
      const surplusEvent = new SurplusCreatedEvent(
        savedPayment.referenceNumber,
        surplusAmountUsd,
        surplusAmountBs,
        savedPayment.url,
        paymentDate,
        invoice.contract?.code ?? '',
        surplusId,
      );
      this.emitOrDefer('surplus.created', surplusEvent, deferredEvents);
    } catch (emitError) {
      this.logger.error(
        `Failed to emit surplus.created event for payment ${savedPayment.id}. The surplus was saved successfully.`,
        emitError instanceof Error ? emitError.stack : String(emitError),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Other public methods
  // ---------------------------------------------------------------------------

  /**
   * Recalculates the invoice's paidAmount from the source of truth:
   * SUM of all non-rejected payments (PROCESSING + COMPLETED).
   * Then derives the invoice status accordingly.
   *
   * When called with a QueryRunner the operation executes within that transaction
   * so a failure rolls back the entire payment + recalculation atomically.
   */
  async recalculateInvoicePaidAmount(invoiceId: string, queryRunner?: QueryRunner): Promise<void> {
    const invoiceRepo = queryRunner
      ? queryRunner.manager.getRepository(Invoice)
      : this.invoiceRepository;
    const paymentRepo = queryRunner
      ? queryRunner.manager.getRepository(Payment)
      : this.paymentRepository;

    const invoice = await invoiceRepo.findOne({ where: { id: invoiceId } });

    if (!invoice) {
      this.logger.warn(`Cannot recalculate: Invoice ${invoiceId} not found.`);
      return;
    }

    const result = await paymentRepo
      .createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'total')
      .where('payment.invoice_id = :invoiceId', { invoiceId })
      .andWhere('payment.status IN (:...statuses)', {
        statuses: [PaymentStatus.PROCESSING, PaymentStatus.COMPLETED],
      })
      .getRawOne<{ total: string }>();

    const newPaidAmount = Number(result?.total ?? 0);
    const totalAmount = Number(invoice.totalAmount);

    invoice.paidAmount = newPaidAmount;

    if (newPaidAmount >= totalAmount) {
      invoice.status = InvoiceStatus.PAID;
    } else if (newPaidAmount > 0) {
      invoice.status = InvoiceStatus.PARTIAL;
    } else {
      invoice.status = InvoiceStatus.PENDING;
    }

    await invoiceRepo.save(invoice);
  }

  async findPendingInvoicesByIdentityCard(
    identityCard: string,
    typeIdentityCard: TypeIdentityCard,
  ): Promise<Invoice[]> {
    return await this.invoiceRepository
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.contract', 'contract')
      .innerJoin('contract.contractPersons', 'contractPerson')
      .innerJoin('contractPerson.person', 'person')
      .where('person.identityCard = :identityCard', { identityCard })
      .andWhere('person.typeIdentityCard = :typeIdentityCard', { typeIdentityCard })
      .andWhere('invoice.status IN (:...statuses)', {
        statuses: [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL],
      })
      .getMany();
  }

  async findInvoicesByIds(ids: string[]): Promise<Invoice[]> {
    if (!ids || ids.length === 0) return [];
    return await this.invoiceRepository
      .createQueryBuilder('invoice')
      .innerJoinAndSelect('invoice.contract', 'contract')
      .where('invoice.id IN (:...ids)', { ids })
      .getMany();
  }

  async calculateAmountByInvoicesIds(ids: string[], paymentMethod: string): Promise<number> {
    if (!ids || ids.length === 0) return 0;

    const fechaVe = DateTime.now().setZone('America/Caracas').toJSDate();
    const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);

    if (!exchangeRate) {
      throw new BadRequestException('Exchange rate not found for date');
    }

    const invoices = await this.findInvoicesByIds(ids);
    const totalAmount = invoices.reduce(
      (sum, inv) => sum + (Number(inv.totalAmount) - Number(inv.paidAmount)),
      0,
    );

    if (paymentMethod === 'transferencia' || paymentMethod === 'pago_movil') {
      return totalAmount * exchangeRate.rateUsd;
    } else {
      return totalAmount;
    }
  }
}
