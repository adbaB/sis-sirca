import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentService } from './payment.service';
import { PaymentCreationService } from './payment-creation.service';
import { PaymentStateService } from './payment-state.service';
import { PaymentUpdateService } from './payment-update.service';
import { PaymentQueryService } from './payment-query.service';
import { Payment } from '../entities/payment.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { InvoiceService } from '../../invoices/services/invoice.service';
import { SurplusService } from './surplus.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';

describe('PaymentService & PaymentCreationService', () => {
  let service: PaymentService;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      createQueryBuilder: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockPaymentRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockExchangeRateService = {
    getExchangeRateByDate: jest.fn(),
  };

  const mockInvoiceService = {
    updateInvoiceStatus: jest.fn(),
    recalculateInvoicePaidAmount: jest.fn(),
  };

  const mockSurplusService = {
    persistSurplus: jest.fn(),
  };

  const mockPaymentStateService = {
    approvePayment: jest.fn(),
    rejectPayment: jest.fn(),
  };

  const mockPaymentUpdateService = {
    updatePaymentDate: jest.fn(),
  };

  const mockPaymentQueryService = {
    findPayments: jest.fn(),
    countPendingPayments: jest.fn(),
    findUnsetPayment: jest.fn(),
    markPaymentsAsSent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        PaymentCreationService,
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentRepository,
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
          provide: InvoiceService,
          useValue: mockInvoiceService,
        },
        {
          provide: SurplusService,
          useValue: mockSurplusService,
        },
        {
          provide: PaymentStateService,
          useValue: mockPaymentStateService,
        },
        {
          provide: PaymentUpdateService,
          useValue: mockPaymentUpdateService,
        },
        {
          provide: PaymentQueryService,
          useValue: mockPaymentQueryService,
        },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    jest.clearAllMocks();
  });

  describe('createPayment - date validation and exchange rate fallback', () => {
    it('should throw BadRequestException when datePaymentReceipt is invalid', async () => {
      const dto: CreatePaymentDto = {
        invoiceId: 'inv-1',
        amount: 50,
        amountExtracted: 1800,
        paymentMethod: 'PAGO_MOVIL',
        referenceNumber: 'REF-123',
        datePaymentReceipt: 'invalid-receipt-date',
      };

      await expect(service.createPayment(dto)).rejects.toThrow(
        new BadRequestException('Formato de fecha de recibo inválido'),
      );
    });

    it('should fallback to system operationDate when rate is not found for datePaymentReceipt', async () => {
      const dto: CreatePaymentDto = {
        invoiceId: 'inv-1',
        amountExtracted: 1800,
        paymentMethod: 'PAGO_MOVIL',
        referenceNumber: 'REF-123',
        datePaymentReceipt: '2026-07-20',
      };

      mockExchangeRateService.getExchangeRateByDate.mockImplementation((date) => {
        const dateStr = typeof date === 'string' ? date : date.toISOString();
        if (dateStr.includes('2026-07-20')) return Promise.resolve(null);
        return Promise.resolve({ rateUsd: 36.5 });
      });

      mockQueryRunner.manager.createQueryBuilder.mockReturnValue({
        setQueryRunner: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'inv-1',
            billingMonth: '2026-07',
            totalAmount: 50,
            paidAmount: 0,
            status: 'PENDING',
          },
        ]),
      });

      mockQueryRunner.manager.create.mockReturnValue({ id: 'pay-1' });

      await service.createPayment(dto);

      expect(mockExchangeRateService.getExchangeRateByDate).toHaveBeenCalledTimes(2);
    });
  });
});
