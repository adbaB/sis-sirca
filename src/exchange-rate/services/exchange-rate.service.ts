import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExchangeRate } from '../entities/Exchange-rate.entity';
import { formatToISODateString } from '../../common/utils/date.util';

export interface PaymentExchangeRateSource {
  amount?: number | string | null;
  amountBs?: number | string | null;
  paymentDate?: Date | string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
  ) {}

  async getExchangeRateByDate(date: Date | string): Promise<ExchangeRate | null> {
    const dateStr = formatToISODateString(date);
    if (!dateStr) return null;

    return this.exchangeRateRepository.findOne({
      where: { date: dateStr as unknown as Date },
    });
  }

  /**
   * Centralized resolution of the effective numeric exchange rate (USD to Bs) for a payment.
   *
   * Priority:
   * 1. Returns null if amountBs is missing, non-finite, or <= 0.
   * 2. Uses payment.metadata.exchangeRate if finite and > 0.
   * 3. Looks up dated exchange rate in DB via getExchangeRateByDate (catches failures).
   * 4. Falls back to calculated ratio: (amountBs / amountUsd) rounded to 2 decimals.
   * 5. Returns null if amountUsd is 0 or no rate could be determined.
   */
  async resolvePaymentExchangeRate(
    payment?: PaymentExchangeRateSource | null,
  ): Promise<number | null> {
    if (!payment) return null;

    const amountBs = Number(payment.amountBs ?? 0);
    if (!Number.isFinite(amountBs) || amountBs <= 0) {
      return null;
    }

    const metaRate = Number(payment.metadata?.exchangeRate);
    if (Number.isFinite(metaRate) && metaRate > 0) {
      return metaRate;
    }

    if (payment.paymentDate) {
      try {
        const rateEntity = await this.getExchangeRateByDate(payment.paymentDate);
        if (rateEntity?.rateUsd) {
          const dbRate = Number(rateEntity.rateUsd);
          if (Number.isFinite(dbRate) && dbRate > 0) {
            return dbRate;
          }
        }
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to get exchange rate for payment date ${payment.paymentDate}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const amountUsd = Number(payment.amount ?? 0);
    if (Number.isFinite(amountUsd) && amountUsd > 0) {
      return Number((amountBs / amountUsd).toFixed(2));
    }

    return null;
  }
}
