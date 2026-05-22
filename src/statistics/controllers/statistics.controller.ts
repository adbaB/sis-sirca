import { Controller, Get, Query } from '@nestjs/common';
import { StatisticsService } from '../services/statistics.service';
import { StatisticsResponse } from '../interfaces/response.interface';
import { Public } from '../../auth/decorators';

@Public()
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  /**
   * GET /statistics?year=2026&month=5
   * GET /statistics?year=2026&month=5&advisorUuid=<uuid>
   *
   * Devuelve:
   *  - summary      → KPIs globales (verified / unverified / partial / pending)
   *  - breakdown    → desglose por estado con montos USD y Bs
   *  - monthlyTrend → tendencia de los últimos 12 meses
   *
   * Si advisorUuid está presente, filtra únicamente los contratos
   * asignados a ese asesor.
   */
  @Get()
  async getStatistics(
    @Query('month_billing') monthBilling: string,
    @Query('advisor_uuid') advisorUuid?: string,
  ): Promise<StatisticsResponse> {
    return this.statisticsService.getStatistics(monthBilling, advisorUuid);
  }
}
