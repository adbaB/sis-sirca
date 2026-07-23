import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentService } from './payment.service';
import { Payment } from '../../entities/payment.entity';
import { ExchangeRateService } from '../../../exchange-rate/services/exchange-rate.service';
import { InvoiceService } from '../../invoices/services/invoice.service';
import { SurplusService } from '../../services/surplus.service';
import { CreatePaymentDto } from '../../dto/create-payment.dto';

describe('PaymentService', () => {
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
  };

  const mockSurplusService = {
    persistSurplus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
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
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    jest.clearAllMocks();
  });

  describe('createPayment - operationDate validation', () => {
    it('should throw BadRequestException when operationDate is invalid', async () => {
      const dto: CreatePaymentDto = {
        invoiceId: 'inv-1',
        amount: 50,
        amountExtracted: 1800,
        paymentMethod: 'PAGO_MOVIL',
        referenceNumber: 'REF-123',
        operationDate: 'invalid-date-string',
      };

      await expect(service.createPayment(dto)).rejects.toThrow(
        new BadRequestException('Formato de fecha de operación inválido'),
      );
    });

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
  });
});
