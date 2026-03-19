import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BillingService } from './billing.service';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { NotFoundException } from '@nestjs/common';
import { Contract } from '../../contracts/entities/contract.entity';

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

  const mockPaymentRepository = {};
  const mockInvoiceRepository = {};

  beforeEach(async () => {
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
      paymentMethod: 'CASH',
      referenceNumber: 'REF123',
    };
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPayment', () => {
    it('should register a Payment and update Invoice status to PARTIAL when new paidAmount < totalAmount', async () => {
      // Arrange
      const dto = createPaymentDto('inv-1', 50);
      const mockInvoice = createMockInvoice('inv-1', 100, 0); // Total 100, Paid 0

      mockQueryRunner.manager.findOne.mockResolvedValue(mockInvoice);
      mockQueryRunner.manager.create.mockImplementation((entity, payload) => payload);

      // Return the updated invoice when saved
      mockQueryRunner.manager.save.mockImplementation(async (entity) => {
        if (entity instanceof Invoice) {
          return entity;
        }
        return entity;
      });

      // Act
      await service.createPayment(dto);

      // Assert
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();

      // Verify invoice fetch with lock
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Invoice, {
        where: { id: dto.invoiceId },
        lock: { mode: 'pessimistic_write' },
      });

      // Verify Payment creation
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        Payment,
        expect.objectContaining({
          invoiceId: dto.invoiceId,
          amount: 50,
          paymentMethod: 'CASH',
          referenceNumber: 'REF123',
          status: PaymentStatus.COMPLETED,
          invoice: mockInvoice,
        }),
      );

      // Verify Invoice update
      expect(mockInvoice.paidAmount).toBe(50);
      expect(mockInvoice.status).toBe(InvoiceStatus.PARTIAL);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(mockInvoice);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should register a Payment and update Invoice status to PAID when new paidAmount == totalAmount', async () => {
      // Arrange
      const dto = createPaymentDto('inv-1', 100);
      const mockInvoice = createMockInvoice('inv-1', 100, 0); // Total 100, paid 0

      mockQueryRunner.manager.findOne.mockResolvedValue(mockInvoice);
      mockQueryRunner.manager.create.mockImplementation((entity, payload) => payload);
      mockQueryRunner.manager.save.mockImplementation(async (entity) => entity);

      // Act
      await service.createPayment(dto);

      // Assert
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();

      // Verify Invoice update
      expect(mockInvoice.paidAmount).toBe(100);
      expect(mockInvoice.status).toBe(InvoiceStatus.PAID);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(mockInvoice);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should register a Payment and update Invoice status to PAID when new paidAmount > totalAmount', async () => {
      // Arrange
      const dto = createPaymentDto('inv-1', 150);
      const mockInvoice = createMockInvoice('inv-1', 100, 0); // Total 100, paid 0

      mockQueryRunner.manager.findOne.mockResolvedValue(mockInvoice);
      mockQueryRunner.manager.create.mockImplementation((entity, payload) => payload);
      mockQueryRunner.manager.save.mockImplementation(async (entity) => entity);

      // Act
      await service.createPayment(dto);

      // Assert
      expect(mockInvoice.paidAmount).toBe(150);
      expect(mockInvoice.status).toBe(InvoiceStatus.PAID);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should correctly call rollbackTransaction if an error occurs while saving', async () => {
      // Arrange
      const dto = createPaymentDto('inv-1', 100);
      const mockInvoice = createMockInvoice('inv-1', 100, 0);

      mockQueryRunner.manager.findOne.mockResolvedValue(mockInvoice);
      mockQueryRunner.manager.create.mockImplementation((entity, payload) => payload);

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
});
