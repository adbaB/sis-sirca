import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DateTime } from 'luxon';
import { DataSource, Repository } from 'typeorm';

import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly dataSource: DataSource,
    private readonly exchangeRateService: ExchangeRateService,
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
        status: PaymentStatus.COMPLETED,
        invoice: invoice,
        referenceNumber: createPaymentDto.referenceNumber,
        amount: amountUsd,
        amountBs: createPaymentDto.paymentMethod !== 'zelle' ? amountExtracted : 0,
        paymentMethod: createPaymentDto.paymentMethod,
        url: createPaymentDto.url,
      });

      await queryRunner.manager.save(payment);

      // Update Invoice
      const newPaidAmount = Number(invoice.paidAmount) + amountUsd;
      const totalAmount = Number(invoice.totalAmount);

      invoice.paidAmount = newPaidAmount;

      if (newPaidAmount >= totalAmount) {
        invoice.status = InvoiceStatus.PAID;
      } else if (newPaidAmount > 0) {
        invoice.status = InvoiceStatus.PARTIAL;
      }

      await queryRunner.manager.save(invoice);

      await queryRunner.commitTransaction();

      return payment;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
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
    const fechaVe = DateTime.now().setZone('America/Caracas').toJSDate();
    const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);
    if (!ids || ids.length === 0) return 0;
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
