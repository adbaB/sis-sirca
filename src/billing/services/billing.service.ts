import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly dataSource: DataSource,
  ) {}

  async createPayment(createPaymentDto: CreatePaymentDto) {
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

      // Create Payment
      const payment = queryRunner.manager.create(Payment, {
        ...createPaymentDto,
        paymentDate: new Date(),
        status: PaymentStatus.COMPLETED,
        invoice: invoice,
      });

      await queryRunner.manager.save(payment);

      // Update Invoice
      const newPaidAmount = Number(invoice.paidAmount) + Number(createPaymentDto.amount);
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
}
