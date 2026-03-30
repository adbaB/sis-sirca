import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BillingService } from './billing.service';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { NotFoundException } from '@nestjs/common';
import { Contract } from '../../contracts/entities/contract.entity';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('BillingService', () => {
  let service: BillingService;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockPaymentRepository = {
    createQueryBuilder: jest.fn(),
  };

  const mockInvoiceRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  let mockEventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentRepository,
        },
        {
          provide: getRepositoryToken(Invoice),
          useValue: mockInvoiceRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ExchangeRateService,
          useValue: {
            getExchangeRateByDate: jest.fn().mockResolvedValue({ rateUsd: 1 }),
          },
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  // --- Helper Factories ---
  const createMockInvoice = (id: string, totalAmount: number, paidAmount: number = 0): Invoice => {
    return {
      id,
      contract: {} as Contract,
      issueDate: new Date(),
      dueDate: new Date(),
      totalAmount,
      paidAmount,
      status: InvoiceStatus.PENDING,
      details: [],
      payments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: new Date(),
    } as Invoice;
  };

  const createPaymentDto = (invoiceId: string, amount: number): CreatePaymentDto => {
    return {
      invoiceId,
      amount,
      amountExtracted: amount,
      paymentMethod: 'CASH',
      referenceNumber: 'REF123',
    };
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPayment', () => {
    it('should create a Payment with PROCESSING status and recalculate invoice after commit', async () => {
      // Arrange
      const dto = createPaymentDto('inv-1', 50);
      const mockInvoice = createMockInvoice('inv-1', 100, 0);

      mockQueryRunner.manager.findOne.mockResolvedValue(mockInvoice);
      mockQueryRunner.manager.create.mockImplementation(
        (_entity: unknown, payload: unknown) => payload,
      );
      mockQueryRunner.manager.save.mockImplementation(async (entity: unknown) => entity);

      // Mock recalculateInvoicePaidAmount dependencies
      mockInvoiceRepository.findOne.mockResolvedValue(mockInvoice);
      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '50' }),
      };
      mockPaymentRepository.createQueryBuilder.mockReturnValue(qb);

      // Spy on recalculate
      const recalcSpy = jest.spyOn(service, 'recalculateInvoicePaidAmount');

      // Act
      await service.createPayment(dto);

      // Assert
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();

      // Verify Payment creation with PROCESSING
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          status: PaymentStatus.PROCESSING,
          invoice: mockInvoice,
        }),
      );

      // Only payment save inside the transaction
      expect(mockQueryRunner.manager.save).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();

      // Recalculation called after commit — invoice now reflects the PROCESSING payment
      expect(recalcSpy).toHaveBeenCalledWith('inv-1');
      expect(mockInvoice.paidAmount).toBe(50);
      expect(mockInvoice.status).toBe(InvoiceStatus.PARTIAL);

      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      recalcSpy.mockRestore();
    });

    it('should correctly call rollbackTransaction if an error occurs while saving', async () => {
      // Arrange
      const dto = createPaymentDto('inv-1', 100);
      const mockInvoice = createMockInvoice('inv-1', 100, 0);

      mockQueryRunner.manager.findOne.mockResolvedValue(mockInvoice);
      mockQueryRunner.manager.create.mockImplementation(
        (_entity: unknown, payload: unknown) => payload,
      );

      // Simulate error
      const mockError = new Error('Database Error');
      mockQueryRunner.manager.save.mockRejectedValue(mockError);

      // Act & Assert
      await expect(service.createPayment(dto)).rejects.toThrow(mockError);

      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should correctly call rollbackTransaction and throw NotFoundException if invoice does not exist', async () => {
      // Arrange
      const dto = createPaymentDto('invalid-id', 100);

      mockQueryRunner.manager.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createPayment(dto)).rejects.toThrow(NotFoundException);

      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('recalculateInvoicePaidAmount', () => {
    const setupQueryBuilder = (total: string) => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total }),
      };
      mockPaymentRepository.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('should set paidAmount to sum of non-rejected payments and status to PARTIAL', async () => {
      const invoice = createMockInvoice('inv-1', 100, 0);
      mockInvoiceRepository.findOne.mockResolvedValue(invoice);
      setupQueryBuilder('50');

      await service.recalculateInvoicePaidAmount('inv-1');

      expect(invoice.paidAmount).toBe(50);
      expect(invoice.status).toBe(InvoiceStatus.PARTIAL);
      expect(mockInvoiceRepository.save).toHaveBeenCalledWith(invoice);
    });

    it('should set status to PAID when paidAmount >= totalAmount', async () => {
      const invoice = createMockInvoice('inv-1', 100, 0);
      mockInvoiceRepository.findOne.mockResolvedValue(invoice);
      setupQueryBuilder('100');

      await service.recalculateInvoicePaidAmount('inv-1');

      expect(invoice.paidAmount).toBe(100);
      expect(invoice.status).toBe(InvoiceStatus.PAID);
      expect(mockInvoiceRepository.save).toHaveBeenCalledWith(invoice);
    });

    it('should reset status to PENDING when all payments are rejected (paidAmount = 0)', async () => {
      const invoice = createMockInvoice('inv-1', 100, 50);
      invoice.status = InvoiceStatus.PARTIAL;
      mockInvoiceRepository.findOne.mockResolvedValue(invoice);
      setupQueryBuilder('0');

      await service.recalculateInvoicePaidAmount('inv-1');

      expect(invoice.paidAmount).toBe(0);
      expect(invoice.status).toBe(InvoiceStatus.PENDING);
      expect(mockInvoiceRepository.save).toHaveBeenCalledWith(invoice);
    });

    it('should do nothing and log a warning if the invoice is not found', async () => {
      mockInvoiceRepository.findOne.mockResolvedValue(null);
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});

      await service.recalculateInvoicePaidAmount('nonexistent');

      expect(mockPaymentRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockInvoiceRepository.save).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
      warnSpy.mockRestore();
    });
  });
});
