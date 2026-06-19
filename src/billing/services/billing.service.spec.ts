import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Contract } from '../../contracts/entities/contract.entity';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { SurplusStatus } from '../entities/surplus.entity';
import { InvoiceLine } from '../invoices/entities/invoice-line.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { BillingService } from './billing.service';
import { SurplusService } from './surplus.service';
import { InvoiceService } from '../invoices/services/invoice.service';
import { PaymentService } from '../payment/services/payment.service';

describe('BillingService', () => {
  let service: BillingService;

  const mockQueryBuilder = {
    setQueryRunner: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({}),
    select: jest.fn().mockReturnThis(),
  };

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
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === Payment) return mockPaymentRepository;
        if (entity === Invoice) return mockInvoiceRepository;
        return {};
      }),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    getRepository: jest.fn().mockImplementation((entity) => {
      if (entity === Payment) return mockPaymentRepository;
      if (entity === Invoice) return mockInvoiceRepository;
      return {};
    }),
  };

  const mockPaymentRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    findOne: jest.fn(),
    save: jest.fn(),
    manager: {
      findOne: jest.fn(),
    },
  };

  const mockInvoiceRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        InvoiceService,
        PaymentService,
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentRepository,
        },
        {
          provide: getRepositoryToken(Invoice),
          useValue: mockInvoiceRepository,
        },
        {
          provide: getRepositoryToken(InvoiceLine),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            find: jest.fn(),
          },
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
          provide: SurplusService,
          useValue: {
            applyPendingSurplusesToInvoice: jest.fn().mockResolvedValue(undefined),
          },
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
  const setupManagerQueryBuilder = (result: Invoice | null) => {
    const qb = {
      setQueryRunner: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(result),
      getMany: jest.fn().mockResolvedValue(result ? [result] : []),
    };
    (mockQueryRunner.manager.createQueryBuilder as jest.Mock).mockReturnValue(qb);
    return qb;
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPayment', () => {
    it('should create a Payment with PROCESSING status and recalculate invoice after commit', async () => {
      // Arrange
      const dto = createPaymentDto('inv-1', 50);
      const mockInvoice = createMockInvoice('inv-1', 100, 0);

      setupManagerQueryBuilder(mockInvoice);
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

      // Mock the enrichedPayment reload (person+contract relations)
      mockPaymentRepository.findOne.mockResolvedValue({
        id: 'payment-id',
        person: { name: 'Test Person' },
        invoice: { contract: { code: 'SIR-001' } },
      });

      // Setup getRepository for the recalculate function during the transaction
      mockQueryRunner.manager.getRepository.mockImplementation((entity) => {
        if (entity === Invoice) return mockInvoiceRepository;
        if (entity === Payment) return mockPaymentRepository;
      });

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

      // Recalculation called inside transaction — invoice now reflects the PROCESSING payment
      expect(mockInvoice.paidAmount).toBe(50);
      expect(mockInvoice.status).toBe(InvoiceStatus.PARTIAL);

      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should correctly call rollbackTransaction if an error occurs while saving', async () => {
      // Arrange
      const dto = createPaymentDto('inv-1', 100);
      const mockInvoice = createMockInvoice('inv-1', 100, 0);

      setupManagerQueryBuilder(mockInvoice);
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

      setupManagerQueryBuilder(null);

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
      const warnSpy = jest
        .spyOn(service['invoiceService']['logger'], 'warn')
        .mockImplementation(() => {});

      await service.recalculateInvoicePaidAmount('nonexistent');

      expect(mockPaymentRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockInvoiceRepository.save).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
      warnSpy.mockRestore();
    });
  });

  describe('approvePayment', () => {
    it('should approve a payment and change status to COMPLETED', async () => {
      const mockInvoice = createMockInvoice('inv-1', 100, 0);
      const mockPayment = {
        id: 'pay-1',
        status: PaymentStatus.PROCESSING,
        invoice: mockInvoice,
        metadata: {},
      } as Payment;

      const qb = {
        setQueryRunner: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPayment),
      };
      (mockQueryRunner.manager.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const mockSurplus = { id: 'surplus-1', status: SurplusStatus.CANCELLED };
      const mockSurplusRepo = {
        find: jest.fn().mockResolvedValue([mockSurplus]),
        save: jest.fn().mockResolvedValue(mockSurplus),
      };
      const mockPaymentRepo = {
        save: jest.fn().mockImplementation(async (p) => p),
        createQueryBuilder: mockPaymentRepository.createQueryBuilder,
      };

      mockQueryRunner.manager.getRepository.mockImplementation((entity) => {
        if (entity === Payment) return mockPaymentRepo;
        if (entity === Invoice || entity.name === 'Invoice') return mockInvoiceRepository;
        if (entity === 'Surplus' || entity.name === 'Surplus') return mockSurplusRepo;
      });

      // Recalculate mocks
      mockInvoiceRepository.findOne.mockResolvedValue(mockInvoice);
      const paymentQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '100' }),
      };
      mockPaymentRepository.createQueryBuilder.mockReturnValue(paymentQb);

      const result = await service.approvePayment('pay-1');

      expect(result.status).toBe(PaymentStatus.COMPLETED);
      expect(mockPaymentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.COMPLETED }),
      );
      expect(mockSurplus.status).toBe(SurplusStatus.PENDING);
      expect(mockSurplusRepo.save).toHaveBeenCalledWith(mockSurplus);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException if payment is already COMPLETED', async () => {
      const mockPayment = {
        id: 'pay-1',
        status: PaymentStatus.COMPLETED,
        invoice: {},
        metadata: {},
      } as Payment;

      const qb = {
        setQueryRunner: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPayment),
      };
      (mockQueryRunner.manager.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await expect(service.approvePayment('pay-1')).rejects.toThrow(BadRequestException);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('rejectPayment', () => {
    it('should reject a payment and change status to REJECTED', async () => {
      const mockInvoice = createMockInvoice('inv-1', 100, 100);
      const mockPayment = {
        id: 'pay-1',
        status: PaymentStatus.PROCESSING,
        invoice: mockInvoice,
        metadata: {},
      } as Payment;

      const qb = {
        setQueryRunner: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPayment),
      };
      (mockQueryRunner.manager.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const mockSurplus = { id: 'surplus-1', status: SurplusStatus.PENDING };
      const mockSurplusRepo = {
        find: jest.fn().mockResolvedValue([mockSurplus]),
        save: jest.fn().mockResolvedValue(mockSurplus),
      };
      const mockPaymentRepo = {
        save: jest.fn().mockImplementation(async (p) => p),
        createQueryBuilder: mockPaymentRepository.createQueryBuilder,
      };

      mockQueryRunner.manager.getRepository.mockImplementation((entity) => {
        if (entity === Payment) return mockPaymentRepo;
        if (entity === Invoice || entity.name === 'Invoice') return mockInvoiceRepository;
        if (entity === 'Surplus' || entity.name === 'Surplus') return mockSurplusRepo;
      });

      // Recalculate mocks
      mockInvoiceRepository.findOne.mockResolvedValue(mockInvoice);
      const paymentQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      };
      mockPaymentRepository.createQueryBuilder.mockReturnValue(paymentQb);

      const result = await service.rejectPayment('pay-1', 'Invalid receipt');

      expect(result.status).toBe(PaymentStatus.REJECTED);
      expect((result.metadata as unknown as { rejectionReason: string }).rejectionReason).toBe(
        'Invalid receipt',
      );
      expect(mockPaymentRepo.save).toHaveBeenCalled();
      expect(mockSurplus.status).toBe(SurplusStatus.CANCELLED);
      expect(mockSurplusRepo.save).toHaveBeenCalledWith(mockSurplus);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException if payment is already REJECTED', async () => {
      const mockPayment = {
        id: 'pay-1',
        status: PaymentStatus.REJECTED,
        invoice: {},
        metadata: {},
      } as Payment;

      const qb = {
        setQueryRunner: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPayment),
      };
      (mockQueryRunner.manager.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await expect(service.rejectPayment('pay-1', 'Reason')).rejects.toThrow(BadRequestException);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });
});
