import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import { Surplus, SurplusStatus } from '../entities/surplus.entity';
import { Invoice } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { ExchangeRate } from '../../exchange-rate/entities/Exchange-rate.entity';
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

      // Fetch pending surpluses inside the transaction with a lock to prevent concurrent applications
      const surpluses = await queryRunner.manager.find(Surplus, {
        where: {
          contract: { id: contractId },
          status: SurplusStatus.PENDING,
          invoice: IsNull(),
        },
        relations: ['payment', 'payment.person'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!surpluses.length) {
        await queryRunner.rollbackTransaction();
        return;
      }

      const fechaVe = DateTime.now().setZone('America/Caracas').toJSDate();
      let exchangeRate: ExchangeRate | null = null;
      let remainingBalanceUsd = Number(invoice.totalAmount) - Number(invoice.paidAmount);

      for (const surplus of surpluses) {
        if (remainingBalanceUsd <= 0.01) {
          // Invoice is already fully covered. Leave remaining surpluses pending.
          break;
        }

        let paymentAmountUsd = 0;
        let paymentAmountBs = 0;

        // If the surplus is in Bs (non-Zelle), convert to USD at current rate
        if (surplus.amountBs && surplus.amountBs > 0) {
          // Lazy fetch the exchange rate only if we actually need it
          if (!exchangeRate) {
            exchangeRate = await this.exchangeRateService.getExchangeRateByDate(fechaVe);
            if (!exchangeRate) {
              throw new Error('Exchange rate not found for current date to apply Bs surplus');
            }
          }

          paymentAmountBs = Number(surplus.amountBs);
          paymentAmountUsd = paymentAmountBs / exchangeRate.rateUsd;
        } else if (surplus.amountUsd && surplus.amountUsd > 0) {
          paymentAmountUsd = Number(surplus.amountUsd);
        }

        if (paymentAmountUsd > 0) {
          // Cap the surplus application to the remaining invoice balance
          let amountToApplyUsd = paymentAmountUsd;
          let amountToApplyBs = paymentAmountBs;
          if (paymentAmountUsd > remainingBalanceUsd) {
            amountToApplyUsd = remainingBalanceUsd;

            // Calculate the proportional Bs reduction if it was originally a Bs payment
            const proportion = amountToApplyUsd / paymentAmountUsd;
            amountToApplyBs = paymentAmountBs * proportion;

            const leftoverUsd = paymentAmountUsd - amountToApplyUsd;
            const leftoverBs = paymentAmountBs - amountToApplyBs;

            // Create a NEW pending surplus for the remainder, tied to the original payment
            const remainingSurplus = queryRunner.manager.create(Surplus, {
              amountUsd: surplus.amountUsd !== null ? leftoverUsd : null,
              amountBs: surplus.amountBs !== null ? leftoverBs : null,
              date: surplus.date, // keep original date
              payment: surplus.payment, // trace back to original payment
              invoice: null,
              contract: surplus.contract,
              status: SurplusStatus.PENDING,
            });
            await queryRunner.manager.save(remainingSurplus);
          }

          // Create a new Payment record applying this surplus segment to the invoice
          const surplusPayment = queryRunner.manager.create(Payment, {
            paymentDate: new Date(),
            status: PaymentStatus.COMPLETED,
            invoice: invoice,
            person: surplus.payment.person,
            referenceNumber: `SURPLUS-${surplus.payment.referenceNumber}`,
            amount: amountToApplyUsd,
            amountBs: amountToApplyBs > 0 ? amountToApplyBs : 0,
            paymentMethod: surplus.payment.paymentMethod,
            url: surplus.payment.url,
          }) as Payment;

          await queryRunner.manager.save(surplusPayment);

          // Update the CURRENT surplus to the consumed amount and mark it APPLIED
          surplus.amountUsd = surplus.amountUsd !== null ? amountToApplyUsd : null;
          surplus.amountBs = surplus.amountBs !== null ? amountToApplyBs : null;
          surplus.status = SurplusStatus.APPLIED;
          surplus.invoice = invoice;
          await queryRunner.manager.save(surplus);

          // Deduct from the running balance tracking
          remainingBalanceUsd -= amountToApplyUsd;

          this.logger.log(
            `Applied surplus ${surplus.id} to invoice ${invoiceId} (applied USD: $${amountToApplyUsd.toFixed(2)})`,
          );
        }
      }

      // We recalculate INSIDE the transaction to rollback everything if it fails
      await this.billingService.recalculateInvoicePaidAmount(invoiceId, queryRunner);

      await queryRunner.commitTransaction();
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
