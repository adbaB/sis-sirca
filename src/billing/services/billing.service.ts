import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DateTime } from 'luxon';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { PaymentRegisteredEvent } from '../events/payment-registered.event';

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

  async createPayment(createPaymentDto: CreatePaymentDto) {
    const amount = Number(createPaymentDto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    const amountExtracted = Number(createPaymentDto.amountExtracted);
    if (createPaymentDto.paymentMethod !== 'zelle') {
      if (!Number.isFinite(amountExtracted) || amountExtracted <= 0) {
        throw new BadRequestException('Payment amount Bs must be greater than 0');
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    let savedPayment: Payment;

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Use pessimistic write lock to prevent race conditions when checking and updating invoice
      const invoice = await queryRunner.manager.findOne(Invoice, {
        where: { id: createPaymentDto.invoiceId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!invoice) {
        throw new NotFoundException(`Invoice with ID ${createPaymentDto.invoiceId} not found`);
      }
      const fechaVe = DateTime.now().setZone('America/Caracas').toJSDate();
      const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);

      if (!exchangeRate) {
        throw new BadRequestException('Exchange rate not found for date');
      }

      let amountUsd = amount;
      if (createPaymentDto.paymentMethod !== 'zelle' && createPaymentDto.amountExtracted) {
        amountUsd = createPaymentDto.amountExtracted / exchangeRate.rateUsd;
      }

      // Create Payment
      const payment = queryRunner.manager.create(Payment, {
        paymentDate: new Date(),
        status: PaymentStatus.PROCESSING,
        invoice: invoice,
        referenceNumber: createPaymentDto.referenceNumber,
        amount: amountUsd,
        amountBs: createPaymentDto.paymentMethod !== 'zelle' ? amountExtracted : 0,
        paymentMethod: createPaymentDto.paymentMethod,
        url: createPaymentDto.url,
      });

      savedPayment = await queryRunner.manager.save(payment);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Recalculate invoice so the user sees the payment credited immediately.
    // If the payment is later Rejected, the CRON recalculation will reverse it.
    await this.recalculateInvoicePaidAmount(createPaymentDto.invoiceId);

    // Emit event outside the transaction block so that a publish failure
    // cannot trigger a rollback or cause the request to be reported as failed.
    // The payment is already persisted at this point.
    try {
      this.eventEmitter.emit(
        'payment.registered',
        new PaymentRegisteredEvent(
          savedPayment!.referenceNumber,
          savedPayment!.amount,
          savedPayment!.amountBs,
          savedPayment!.url,
          savedPayment!.createdAt || new Date(),
        ),
      );
    } catch (emitError) {
      this.logger.error(
        `Failed to emit payment.registered event for payment ${
          savedPayment!.id
        }. The payment was saved successfully.`,
        emitError instanceof Error ? emitError.stack : String(emitError),
      );
    }

    return savedPayment!;
  }

  /**
   * Recalculates the invoice's paidAmount from the source of truth:
   * SUM of all non-rejected payments (PROCESSING + COMPLETED).
   * Then derives the invoice status accordingly.
   */
  async recalculateInvoicePaidAmount(invoiceId: string): Promise<void> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
    });

    if (!invoice) {
      this.logger.warn(`Cannot recalculate: Invoice ${invoiceId} not found.`);
      return;
    }

    const result = await this.paymentRepository
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

    await this.invoiceRepository.save(invoice);
  }

  async findPendingInvoicesByIdentityCard(
    identityCard: string,
    typeIdentityCard: TypeIdentityCard,
  ): Promise<Invoice[]> {
    return this.invoiceRepository
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
    return this.invoiceRepository
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
