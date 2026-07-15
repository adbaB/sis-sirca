import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ExchangeRateService } from '../services/exchange-rate.service';
import { getCaracasTodayJSDate } from '../../common/utils/date.util';

@Controller('exchange-rate')
export class ExchangeRateController {
  constructor(private readonly exchangeRateService: ExchangeRateService) {}

  @Get()
  async getExchangeRate(@Query('date') date?: string) {
    const rate = await this.exchangeRateService.getExchangeRateByDate(
      date || getCaracasTodayJSDate(),
    );
    if (!rate) {
      throw new BadRequestException(
        `No se encontró la tasa de cambio para la fecha ${date || 'de hoy'}.`,
      );
    }
    return rate;
  }
}
