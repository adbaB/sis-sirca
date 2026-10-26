import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DateTime } from 'luxon';
import { Repository } from 'typeorm';
import { CARACAS_ZONE, getCaracasNow } from '../../common/utils/date.util';
import { Eventuality } from '../entities/eventuality.entity';
import {
  DailyEventualityStatItem,
  EventualityDailyStatsResponse,
} from '../interfaces/eventuality-stats.interface';

@Injectable()
export class EventualityStatisticsService {
  private readonly logger = new Logger(EventualityStatisticsService.name);

  constructor(
    @InjectRepository(Eventuality)
    private readonly eventualityRepo: Repository<Eventuality>,
  ) {}

  /**
   * Retrieves daily created eventualities count for a billing cycle:
   * From day 25 of (target month - 1) to day 24 of target month in America/Caracas timezone.
   */
  async getDailyCreatedStats(
    month?: number,
    year?: number,
  ): Promise<EventualityDailyStatsResponse> {
    const now = getCaracasNow();
    const targetMonth = month ?? now.month;
    const targetYear = year ?? now.year;

    const monthDt = DateTime.fromObject(
      { year: targetYear, month: targetMonth, day: 1 },
      { zone: CARACAS_ZONE },
    );

    // Standard billing period: 25 of (month - 1) to 24 of target month
    const start = monthDt.minus({ months: 1 }).set({ day: 25 }).startOf('day');
    const end = monthDt.set({ day: 24 }).endOf('day');

    const startDateStr = start.toISO()!;
    const endDateStr = end.toISO()!;

    // Query aggregated counts grouped by Caracas date
    const rawStats = await this.eventualityRepo
      .createQueryBuilder('e')
      .select("TO_CHAR(e.created_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD')", 'day_date')
      .addSelect('COUNT(e.id)::int', 'count')
      .where('e.created_at >= :startDate', { startDate: startDateStr })
      .andWhere('e.created_at <= :endDate', { endDate: endDateStr })
      .andWhere('e.deleted_at IS NULL')
      .groupBy("TO_CHAR(e.created_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD')")
      .orderBy('day_date', 'ASC')
      .getRawMany<{ day_date: string; count: string | number }>();

    const countMap = new Map<string, number>();
    for (const row of rawStats) {
      countMap.set(row.day_date, Number(row.count) || 0);
    }

    // Build continuous days timeline from start to end
    const days: DailyEventualityStatItem[] = [];
    let current = start.startOf('day');
    const endDay = end.startOf('day');

    let totalCount = 0;
    let peakCount = 0;
    let peakDay: { date: string | null; label: string | null; count: number } = {
      date: null,
      label: null,
      count: 0,
    };

    while (current <= endDay) {
      const dateStr = current.toFormat('yyyy-MM-dd');
      const count = countMap.get(dateStr) ?? 0;
      totalCount += count;

      const rawMonth = current.setLocale('es').toFormat('LLL').replace('.', '');
      const label = `${current.day} ${rawMonth}`;
      const fullDate = current.setLocale('es').toFormat("dd 'de' MMMM, yyyy");

      if (count > peakCount || (count > 0 && peakDay.date === null)) {
        peakCount = count;
        peakDay = {
          date: dateStr,
          label,
          count,
        };
      }

      days.push({
        date: dateStr,
        day: current.day,
        label,
        fullDate,
        count,
      });

      current = current.plus({ days: 1 });
    }

    // If all counts are 0, use first day as reference
    if (peakDay.date === null && days.length > 0) {
      peakDay = {
        date: days[0].date,
        label: days[0].label,
        count: 0,
      };
    }

    const dailyAverage = days.length > 0 ? Number((totalCount / days.length).toFixed(1)) : 0;
    const rawMonthLabel = monthDt.setLocale('es').toFormat('LLLL yyyy');
    const capitalizedMonthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1);

    return {
      period: {
        startDate: start.toFormat('yyyy-MM-dd'),
        endDate: end.toFormat('yyyy-MM-dd'),
        month: targetMonth,
        year: targetYear,
        monthLabel: capitalizedMonthLabel,
      },
      totalCount,
      dailyAverage,
      peakDay,
      days,
    };
  }
}
