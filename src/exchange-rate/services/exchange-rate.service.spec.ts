import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExchangeRateService } from './exchange-rate.service';
import { ExchangeRate } from '../entities/Exchange-rate.entity';

describe('ExchangeRateService', () => {
  let service: ExchangeRateService;
  let repo: jest.Mocked<Repository<ExchangeRate>>;

  beforeEach(async () => {
    const mockRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeRateService,
        {
          provide: getRepositoryToken(ExchangeRate),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<ExchangeRateService>(ExchangeRateService);
    repo = module.get(getRepositoryToken(ExchangeRate));
  });

  it('should return exact match when available', async () => {
    const mockRate = {
      uuid: '1',
      date: new Date('2026-09-08'),
      rateUsd: 820.1,
      rateEur: 900.0,
    } as ExchangeRate;
    repo.findOne.mockResolvedValueOnce(mockRate);

    const result = await service.getExchangeRateByDate('2026-09-08');

    expect(result).toBe(mockRate);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { date: '2026-09-08' as unknown as Date },
    });
  });

  it('should return null when no rate exists for the date', async () => {
    repo.findOne.mockResolvedValueOnce(null);

    const result = await service.getExchangeRateByDate('2026-09-07');

    expect(result).toBeNull();
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { date: '2026-09-07' as unknown as Date },
    });
  });

  it('should return null when date is invalid or empty', async () => {
    const result = await service.getExchangeRateByDate('');
    expect(result).toBeNull();
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});
