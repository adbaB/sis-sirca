import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SurplusService } from './surplus.service';
import { Surplus, SurplusStatus } from '../entities/surplus.entity';
import { Payment } from '../entities/payment.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { InvoiceCalculationService } from '../../invoices/services/invoice-calculation.service';
import { InvoiceCreatedEvent } from '../../invoices/events/invoice.events';

describe('SurplusService', () => {
  let service: SurplusService;

  const mockSurplusRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    manager: {
      save: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      createQueryBuilder: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      getRepository: jest.fn().mockReturnValue(mockSurplusRepository),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    getRepository: jest.fn().mockReturnValue(mockSurplusRepository),
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

  describe('updateSurplusStatus', () => {
    it('should throw NotFoundException when surplus does not exist', async () => {
      mockSurplusRepository.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.updateSurplusStatus('non-existent', {
          status: SurplusStatus.REFUNDED,
        }),
      ).rejects.toThrow('Excedente con ID non-existent no encontrado');
    });

    it('should throw BadRequestException when surplus is in APPLIED status', async () => {
      mockSurplusRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-applied',
        status: SurplusStatus.APPLIED,
      });

      await expect(
        service.updateSurplusStatus('s-applied', {
          status: SurplusStatus.REFUNDED,
        }),
      ).rejects.toThrow(
        'No se puede modificar el estado de un excedente que ya ha sido aplicado a una factura.',
      );
    });

    it('should throw BadRequestException when attempting to transition to APPLIED manually', async () => {
      mockSurplusRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        status: SurplusStatus.PENDING,
      });

      await expect(
        service.updateSurplusStatus('s-1', {
          status: SurplusStatus.APPLIED,
        }),
      ).rejects.toThrow(
        'No se puede asignar manualmente el estado "applied". Los excedentes se aplican al imputarse a facturas.',
      );
    });

    it('should throw BadRequestException when transition is invalid', async () => {
      mockSurplusRepository.findOne = jest.fn().mockResolvedValue({
        id: 's-1',
        status: SurplusStatus.PENDING,
      });

      await expect(
        service.updateSurplusStatus('s-1', {
          status: SurplusStatus.PENDING, // PENDING -> PENDING not in ALLOWED_SURPLUS_TRANSITIONS
        }),
      ).rejects.toThrow('Transición de estado no permitida');
    });

    it('should update surplus to REFUNDED with reason and metadata', async () => {
      const mockSurplus = {
        id: 's-1',
        status: SurplusStatus.PENDING,
        metadata: null,
      };

      const reloadedSurplus = {
        id: 's-1',
        status: SurplusStatus.REFUNDED,
        metadata: {
          statusChangeReason: 'Reembolso por transferencia',
          previousStatus: SurplusStatus.PENDING,
        },
      };

      mockSurplusRepository.findOne = jest
        .fn()
        .mockResolvedValueOnce(mockSurplus)
        .mockResolvedValueOnce(reloadedSurplus);
      mockSurplusRepository.save = jest.fn().mockResolvedValue(mockSurplus);

      const result = await service.updateSurplusStatus('s-1', {
        status: SurplusStatus.REFUNDED,
        reason: 'Reembolso por transferencia',
      });

      expect(mockSurplusRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SurplusStatus.REFUNDED,
          metadata: expect.objectContaining({
            statusChangeReason: 'Reembolso por transferencia',
            previousStatus: SurplusStatus.PENDING,
          }),
        }),
      );
      expect(result.status).toBe(SurplusStatus.REFUNDED);
    });

    it('should reactivate REFUNDED surplus to PENDING', async () => {
      const mockSurplus = {
        id: 's-1',
        status: SurplusStatus.REFUNDED,
        metadata: { statusChangeReason: 'Reembolso previo' },
      };

      const reloadedSurplus = {
        id: 's-1',
        status: SurplusStatus.PENDING,
        metadata: {
          statusChangeReason: 'Error administrativo en reembolso',
          previousStatus: SurplusStatus.REFUNDED,
        },
      };

      mockSurplusRepository.findOne = jest
        .fn()
        .mockResolvedValueOnce(mockSurplus)
        .mockResolvedValueOnce(reloadedSurplus);
      mockSurplusRepository.save = jest.fn().mockResolvedValue(mockSurplus);

      const result = await service.updateSurplusStatus('s-1', {
        status: SurplusStatus.PENDING,
        reason: 'Error administrativo en reembolso',
      });

      expect(mockSurplusRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SurplusStatus.PENDING,
        }),
      );
      expect(result.status).toBe(SurplusStatus.PENDING);
    });
  });

  describe('applyPendingSurplusesToInvoice', () => {
    it('should convert Bs surplus using rate of the day and keep surplus amountUsd null', async () => {
      const mockInvoice = {
        id: 'inv-1',
        totalAmount: 50,
        retentionAmount: 0,
        paidAmount: 20, // remaining balance = 30 USD
      };

      const mockSurplus = {
        id: 's-bs-1',
        amountBs: 2000,
        amountUsd: null,
        date: new Date('2026-07-01'),
        payment: {
          id: 'p-orig',
          person: { id: 'person-1' },
          referenceNumber: '123456',
          paymentMethod: 'PAGO_MOVIL',
          url: null,
        },
        contract: { id: 'c-1' },
        status: SurplusStatus.PENDING,
      };

      mockQueryRunner.manager.createQueryBuilder.mockReturnValue({
        setQueryRunner: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockInvoice),
      });

      // 1st find: locked surpluses without relations
      // 2nd find: surpluses with relations
      mockQueryRunner.manager.find = jest
        .fn()
        .mockResolvedValueOnce([{ id: 's-bs-1' }])
        .mockResolvedValueOnce([mockSurplus]);

      // Today exchange rate = 50 Bs/USD.
      // Available = 2000 Bs / 50 = 40 USD.
      // Applied to invoice (balance 30 USD) = 30 USD, 1500 Bs.
      // Leftover = 500 Bs, leftover USD = null.
      mockExchangeRateService.getExchangeRateByDate.mockResolvedValue({
        rateUsd: 50,
      });

      mockQueryRunner.manager.create.mockImplementation((entityClass, data) => data);
      mockQueryRunner.manager.save.mockImplementation((entity) => Promise.resolve(entity));

      await service.applyPendingSurplusesToInvoice('c-1', 'inv-1');

      // Exchange rate of today was requested
      expect(mockExchangeRateService.getExchangeRateByDate).toHaveBeenCalled();

      // Check remaining surplus created: Bs = 500, amountUsd = null
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        Surplus,
        expect.objectContaining({
          amountBs: 500,
          amountUsd: null,
          status: SurplusStatus.PENDING,
        }),
      );

      // Check synthetic Payment created: amount = 30 (USD), amountBs = 1500
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          amount: 30,
          amountBs: 1500,
          referenceNumber: 'SURPLUS-123456',
        }),
      );

      // Check applied surplus updated: amountBs = 1500, amountUsd = null, status = APPLIED
      expect(mockSurplus.amountBs).toBe(1500);
      expect(mockSurplus.amountUsd).toBeNull();
      expect(mockSurplus.status).toBe(SurplusStatus.APPLIED);

      // Check invoice recalculation was triggered
      expect(mockInvoiceCalculationService.recalculateInvoicePaidAmount).toHaveBeenCalledWith(
        'inv-1',
        mockQueryRunner.manager,
      );
    });
  });
});
