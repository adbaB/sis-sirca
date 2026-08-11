import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SurplusService } from './surplus.service';
import { Surplus } from '../entities/surplus.entity';
import { Payment } from '../entities/payment.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { InvoiceCalculationService } from '../../invoices/services/invoice-calculation.service';
import { InvoiceCreatedEvent } from '../../invoices/events/invoice.events';

describe('SurplusService', () => {
  let service: SurplusService;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      createQueryBuilder: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    getRepository: jest.fn(),
  };

  const mockSurplusRepository = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    manager: {
      save: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockExchangeRateService = {
    getExchangeRateByDate: jest.fn(),
  };

  const mockInvoiceCalculationService = {
    recalculateInvoicePaidAmount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurplusService,
        {
          provide: getRepositoryToken(Surplus),
          useValue: mockSurplusRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ExchangeRateService,
          useValue: mockExchangeRateService,
        },
        {
          provide: InvoiceCalculationService,
          useValue: mockInvoiceCalculationService,
        },
      ],
    }).compile();

    service = module.get<SurplusService>(SurplusService);
    jest.clearAllMocks();
  });

  describe('persistSurplus', () => {
    it('should return null when surplus amounts are null', async () => {
      const result = await service.persistSurplus(
        null,
        {} as unknown as Invoice,
        {} as unknown as Payment,
        new Date(),
        null,
        null,
      );
      expect(result).toBeNull();
    });

    it('should save and return surplus ID when amounts are provided', async () => {
      const mockSavedSurplus = { id: 'surplus-123' };
      mockSurplusRepository.manager.create.mockReturnValue(mockSavedSurplus);
      mockSurplusRepository.manager.save.mockResolvedValue(mockSavedSurplus);

      const result = await service.persistSurplus(
        null,
        { contract: { id: 'c-1' } } as unknown as Invoice,
        { id: 'p-1' } as unknown as Payment,
        new Date(),
        50,
        null,
      );

      expect(result).toBe('surplus-123');
    });
  });

  describe('handleInvoiceCreated', () => {
    it('should call applyPendingSurplusesToInvoice when event is received', async () => {
      const applySpy = jest
        .spyOn(service, 'applyPendingSurplusesToInvoice')
        .mockResolvedValue(undefined);

      const event: InvoiceCreatedEvent = { contractId: 'c-1', invoiceId: 'inv-1' };
      await service.handleInvoiceCreated(event);

      expect(applySpy).toHaveBeenCalledWith('c-1', 'inv-1');
    });
  });
});
