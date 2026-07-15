import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExchangeRate } from '../entities/Exchange-rate.entity';
import { formatToISODateString } from '../../common/utils/date.util';

@Injectable()
export class ExchangeRateService {
  constructor(
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
  ) {}

  async getExchangeRateByDate(date: Date | string): Promise<ExchangeRate | null> {
    const dateStr = formatToISODateString(date);
    return this.exchangeRateRepository.findOne({ where: { date: dateStr as unknown as Date } });
  }
}
