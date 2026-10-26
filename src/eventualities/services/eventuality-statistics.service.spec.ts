import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Eventuality } from '../entities/eventuality.entity';
import { EventualityStatisticsService } from './eventuality-statistics.service';

describe('EventualityStatisticsService', () => {
  let service: EventualityStatisticsService;
  let mockQueryBuilder: {
    select: ReturnType<typeof vi.fn>;
    addSelect: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    andWhere: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    getRawMany: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventualityStatisticsService,
        {
          provide: getRepositoryToken(Eventuality),
          useValue: {
            createQueryBuilder: vi.fn(() => mockQueryBuilder),
          },
        },
      ],
    }).compile();

    service = module.get<EventualityStatisticsService>(EventualityStatisticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should calculate 25 to 24 billing cycle for October 2026 and map daily counts', async () => {
    // Mock DB returning 2 days with data
    mockQueryBuilder.getRawMany.mockResolvedValueOnce([
      { day_date: '2026-09-25', count: '2' },
      { day_date: '2026-10-05', count: '5' },
    ]);

    const result = await service.getDailyCreatedStats(10, 2026);

    expect(result.period.startDate).toBe('2026-09-25');
    expect(result.period.endDate).toBe('2026-10-24');
    expect(result.period.month).toBe(10);
    expect(result.period.year).toBe(2026);
    expect(result.period.monthLabel.toLowerCase()).toContain('octubre 2026');

    // 25 Sep to 30 Sep = 6 days; 1 Oct to 24 Oct = 24 days. Total = 30 days
    expect(result.days).toHaveLength(30);

    // First day check
    expect(result.days[0].date).toBe('2026-09-25');
    expect(result.days[0].count).toBe(2);

    // Zero-count day check
    const sep26 = result.days.find((d) => d.date === '2026-09-26');
    expect(sep26?.count).toBe(0);

    // Peak day
    const oct5 = result.days.find((d) => d.date === '2026-10-05');
    expect(oct5?.count).toBe(5);

    expect(result.totalCount).toBe(7);
    expect(result.dailyAverage).toBeCloseTo(0.2, 1);
    expect(result.peakDay.date).toBe('2026-10-05');
    expect(result.peakDay.count).toBe(5);
  });

  it('should handle January roll-over spanning December of previous year', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValueOnce([]);

    const result = await service.getDailyCreatedStats(1, 2026);

    expect(result.period.startDate).toBe('2025-12-25');
    expect(result.period.endDate).toBe('2026-01-24');
    // 25 Dec to 31 Dec = 7 days; 1 Jan to 24 Jan = 24 days. Total = 31 days
    expect(result.days).toHaveLength(31);
    expect(result.totalCount).toBe(0);
    expect(result.dailyAverage).toBe(0);
  });

  it('should use default current Caracas date when month and year are omitted', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValueOnce([]);

    const result = await service.getDailyCreatedStats();

    expect(result.period.startDate.endsWith('-25')).toBe(true);
    expect(result.period.endDate.endsWith('-24')).toBe(true);
    expect(result.days.length).toBeGreaterThanOrEqual(28);
  });
});
