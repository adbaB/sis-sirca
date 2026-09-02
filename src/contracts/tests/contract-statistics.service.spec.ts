import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { Contract } from '../entities/contract.entity';
import { ContractQueryRepository } from '../repositories/contract-query.repository';
import { ContractStatisticsService } from '../services/contract-statistics.service';

describe('ContractStatisticsService', () => {
  let service: ContractStatisticsService;
  let queryRepository: jest.Mocked<ContractQueryRepository>;
  let affiliationHistoryRepository: jest.Mocked<Repository<AffiliationHistory>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractStatisticsService,
        {
          provide: ContractQueryRepository,
          useValue: {
            buildTargetBillingMonth: jest.fn().mockImplementation(({ month, year }) => {
              if (month && year) return `${year}-${String(month).padStart(2, '0')}`;
              return undefined;
            }),
            findContractsForPipeline: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AffiliationHistory),
          useValue: {
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContractStatisticsService>(ContractStatisticsService);
    queryRepository = module.get(ContractQueryRepository);
    affiliationHistoryRepository = module.get(getRepositoryToken(AffiliationHistory));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPipelineStats', () => {
    it('should calculate monthly stats when month and year provided', async () => {
      const mockContract = {
        id: 'c-1',
        monthlyAmount: 50,
        invoices: [
          {
            billingMonth: '2026-08',
            baseAmount: 50,
            totalAmount: 50,
            paidAmount: 50,
            status: 'PAID',
            payments: [],
          },
        ],
      } as unknown as Contract;

      queryRepository.findContractsForPipeline.mockResolvedValue([mockContract]);

      const res = await service.getPipelineStats(undefined, '08', '2026');

      expect(res.stats.totalPipeline).toBe(50);
      expect(res.stats.totalCollected).toBe(50);
      expect(res.counts.paid).toBe(1);
    });

    it('should calculate cumulative stats when no month/year provided', async () => {
      const mockContract = {
        id: 'c-1',
        monthlyAmount: 75,
        invoices: [
          {
            status: 'PENDING',
            totalAmount: 75,
            paidAmount: 0,
            payments: [],
          },
        ],
      } as unknown as Contract;

      queryRepository.findContractsForPipeline.mockResolvedValue([mockContract]);

      const res = await service.getPipelineStats();

      expect(res.stats.totalPipeline).toBe(75);
      expect(res.stats.totalPending).toBe(75);
      expect(res.counts.pending).toBe(1);
    });
  });

  describe('getAffiliationStats', () => {
    it('should aggregate history stats in billing mode', async () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          new_affiliations: '10',
          disaffiliations: '2',
          revenue_gained: '300.00',
          revenue_lost: '60.00',
        }),
      };

      affiliationHistoryRepository.createQueryBuilder.mockReturnValue(
        mockQb as unknown as SelectQueryBuilder<AffiliationHistory>,
      );

      const res = await service.getAffiliationStats(8, 2026, 'billing');

      expect(mockQb.andWhere).toHaveBeenCalledWith(
        "(h.reason IS NULL OR h.reason NOT LIKE 'REVERTIDO:%')",
      );

      expect(res.newAffiliations).toBe(10);
      expect(res.disaffiliations).toBe(2);
      expect(res.netChange).toBe(8);
      expect(res.netRevenueChange).toBe(240);
    });
  });
});
