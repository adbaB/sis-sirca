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

  describe('resolvePaymentExchangeRate', () => {
    it('should return null when payment is null or undefined', async () => {
      expect(await service.resolvePaymentExchangeRate(null)).toBeNull();
      expect(await service.resolvePaymentExchangeRate(undefined)).toBeNull();
    });

    it('should return null when amountBs is null, 0, or negative', async () => {
      expect(await service.resolvePaymentExchangeRate({ amountBs: 0, amount: 10 })).toBeNull();
      expect(await service.resolvePaymentExchangeRate({ amountBs: null, amount: 10 })).toBeNull();
      expect(await service.resolvePaymentExchangeRate({ amountBs: -50, amount: 10 })).toBeNull();
    });

    it('should prioritize payment.metadata.exchangeRate over DB lookup', async () => {
      const result = await service.resolvePaymentExchangeRate({
        amountBs: 8300,
        amount: 10,
        paymentDate: new Date('2026-09-08'),
        metadata: { exchangeRate: 830.0 },
      });

      expect(result).toBe(830.0);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('should look up DB rate when metadata.exchangeRate is missing or invalid', async () => {
      const mockRate = {
        uuid: '2',
        date: new Date('2026-09-08'),
        rateUsd: 820.1,
      } as ExchangeRate;
      repo.findOne.mockResolvedValueOnce(mockRate);

      const result = await service.resolvePaymentExchangeRate({
        amountBs: 8201,
        amount: 10,
        paymentDate: new Date('2026-09-08'),
        metadata: { exchangeRate: 'invalid' },
      });

      expect(result).toBe(820.1);
      expect(repo.findOne).toHaveBeenCalled();
    });

    it('should catch DB error and fallback to amountBs/amountUsd', async () => {
      repo.findOne.mockRejectedValueOnce(new Error('Connection lost'));

      const result = await service.resolvePaymentExchangeRate({
        amountBs: 8400,
        amount: 10,
        paymentDate: new Date('2026-09-08'),
      });

      expect(result).toBe(840.0);
    });

    it('should fallback to amountBs/amountUsd when DB has no rate for the date', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      const result = await service.resolvePaymentExchangeRate({
        amountBs: 8500,
        amount: 10,
        paymentDate: new Date('2026-09-08'),
      });

      expect(result).toBe(850.0);
    });

    it('should return null when no rate found and amountUsd is 0', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      const result = await service.resolvePaymentExchangeRate({
        amountBs: 8500,
        amount: 0,
        paymentDate: new Date('2026-09-08'),
      });

      expect(result).toBeNull();
    });
  });
});
