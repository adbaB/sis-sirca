import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import { Surplus, SurplusStatus } from '../entities/surplus.entity';
import { Invoice } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { DateTime } from 'luxon';
import { BillingService } from './billing.service';

@Injectable()
export class SurplusService {
  private readonly logger = new Logger(SurplusService.name);

  constructor(
    @InjectRepository(Surplus)
    private readonly surplusRepository: Repository<Surplus>,
    private readonly dataSource: DataSource,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Applies any pending surpluses for a contract to a specific invoice.
   * This should be called after an invoice is created.
   */
  async applyPendingSurplusesToInvoice(contractId: string, invoiceId: string): Promise<void> {
    const surpluses = await this.surplusRepository.find({
      where: {
        contract: { id: contractId },
        status: SurplusStatus.PENDING,
        invoice: IsNull(),
      },
      relations: ['payment', 'payment.person'],
    });

    if (!surpluses.length) {
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const invoice = await queryRunner.manager
        .createQueryBuilder(Invoice, 'invoice')
        .setQueryRunner(queryRunner)
        .where('invoice.id = :id', { id: invoiceId })
        .setLock('pessimistic_write')
        .getOne();

      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      const fechaVe = DateTime.now().setZone('America/Caracas').toJSDate();
      const exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);

      if (!exchangeRate) {
        throw new Error('Exchange rate not found for current date to apply surplus');
      }

      for (const surplus of surpluses) {
        let paymentAmountUsd = 0;
        let paymentAmountBs = 0;

        // If the surplus is in Bs (non-Zelle), convert to USD at current rate
        if (surplus.amountBs && surplus.amountBs > 0) {
          paymentAmountBs = Number(surplus.amountBs);
          paymentAmountUsd = paymentAmountBs / exchangeRate.rateUsd;
        } else if (surplus.amountUsd && surplus.amountUsd > 0) {
          paymentAmountUsd = Number(surplus.amountUsd);
        }

        if (paymentAmountUsd > 0) {
          // Create a new Payment record applying this surplus
          const surplusPayment = queryRunner.manager.create(Payment, {
            paymentDate: new Date(),
            status: PaymentStatus.COMPLETED,
            invoice: invoice,
            person: surplus.payment.person,
            referenceNumber: `SURPLUS-${surplus.payment.referenceNumber}`,
            amount: paymentAmountUsd,
            amountBs: paymentAmountBs > 0 ? paymentAmountBs : 0,
            paymentMethod: surplus.payment.paymentMethod,
            url: surplus.payment.url,
          }) as Payment;

          await queryRunner.manager.save(surplusPayment);

          // Update the surplus to applied
          surplus.status = SurplusStatus.APPLIED;
          surplus.invoice = invoice;
          await queryRunner.manager.save(surplus);

          this.logger.log(`Applied surplus ${surplus.id} to invoice ${invoiceId}`);
        }
      }

      await queryRunner.commitTransaction();

      // We recalculate outside of transaction to update the invoice correctly
      await this.billingService.recalculateInvoicePaidAmount(invoiceId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Error applying surpluses to invoice ${invoiceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await queryRunner.release();
    }
  }
}
