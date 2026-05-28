import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExchangeRate } from '../entities/Exchange-rate.entity';
import { DateTime } from 'luxon';

@Injectable()
export class ExchangeRateService {
  constructor(
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
  ) {}

  async getExchangeRateByDate(date: Date | string): Promise<ExchangeRate | null> {
    const dateStr =
      typeof date === 'string'
        ? date
        : DateTime.fromJSDate(date).setZone('America/Caracas').toFormat('yyyy-MM-dd');
    return this.exchangeRateRepository.findOne({ where: { date: dateStr as unknown as Date } });
  }
}
