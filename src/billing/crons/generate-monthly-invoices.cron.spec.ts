import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceGenerationService } from '../invoices/services/invoice-generation.service';
import { GenerateMonthlyInvoices } from './generate-monthly-invoices.cron';

describe('GenerateMonthlyInvoices', () => {
  let service: GenerateMonthlyInvoices;
  let mockInvoiceGenerationService: { generateInvoiceForContract: jest.Mock };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    isTransactionActive: true,
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockContractRepository = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    mockInvoiceGenerationService = {
      generateInvoiceForContract: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenerateMonthlyInvoices,
        {
          provide: getRepositoryToken(Contract),
          useValue: mockContractRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: InvoiceGenerationService,
          useValue: mockInvoiceGenerationService,
        },
      ],
    }).compile();

    service = module.get<GenerateMonthlyInvoices>(GenerateMonthlyInvoices);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  // --- Helper Factories ---
  const createMockContract = (id: string, overrides: Partial<Contract> = {}): Contract => {
    return {
      id,
      affiliationDate: new Date(),
      monthlyAmount: 0,
      status: ContractStatus.ACTIVE,
      contractPersons: [],
      invoices: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: new Date(),
      ...overrides,
    } as unknown as Contract;
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateMonthlyInvoices', () => {
    it('should call InvoiceGenerationService.generateInvoiceForContract for each active contract', async () => {
      // Arrange
      const mockContract = createMockContract('contract-1');
      const mockInvoice = { id: 'invoice-1' } as Invoice;

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockInvoiceGenerationService.generateInvoiceForContract.mockResolvedValue(mockInvoice);

      // Act
      await service.generateMonthlyInvoices();

      // Assert
      expect(mockContractRepository.find).toHaveBeenCalledTimes(2);
      expect(mockInvoiceGenerationService.generateInvoiceForContract).toHaveBeenCalledTimes(1);
      expect(mockInvoiceGenerationService.generateInvoiceForContract).toHaveBeenCalledWith(
        'contract-1',
        expect.stringMatching(/^\d{4}-\d{2}$/), // billingMonth YYYY-MM
      );
    });

    it('should process multiple contracts in chunks', async () => {
      // Arrange
      const contract1 = createMockContract('contract-1');
      const contract2 = createMockContract('contract-2');
      const contract3 = createMockContract('contract-3');

      mockContractRepository.find
        .mockResolvedValueOnce([contract1, contract2, contract3])
        .mockResolvedValueOnce([]);

      mockInvoiceGenerationService.generateInvoiceForContract.mockResolvedValue({
        id: 'any-invoice',
      });

      // Act
      await service.generateMonthlyInvoices();

      // Assert
      expect(mockInvoiceGenerationService.generateInvoiceForContract).toHaveBeenCalledTimes(3);
    });

    it('should skip a contract if InvoiceGenerationService throws BadRequestException (idempotency)', async () => {
      // Arrange
      const mockContract = createMockContract('contract-1');

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockInvoiceGenerationService.generateInvoiceForContract.mockRejectedValue(
        new BadRequestException('Ya existe una factura para este contrato en el mes 2026-09'),
      );

      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => {});

      // Act
      await service.generateMonthlyInvoices();

      // Assert - should log skip, not error
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping contract contract-1'));
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should skip a contract on Postgres unique violation (23505)', async () => {
      // Arrange
      const mockContract = createMockContract('contract-1');

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      const pgError = new Error('duplicate key value violates unique constraint');
      Object.assign(pgError, { code: '23505' });
      mockInvoiceGenerationService.generateInvoiceForContract.mockRejectedValue(pgError);

      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => {});

      // Act
      await service.generateMonthlyInvoices();

      // Assert
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping contract contract-1'));

      logSpy.mockRestore();
    });

    it('should log error when InvoiceGenerationService throws unexpected error', async () => {
      // Arrange
      const mockContract = createMockContract('contract-1');

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockInvoiceGenerationService.generateInvoiceForContract.mockRejectedValue(
        new Error('Database connection failed'),
      );

      const loggerErrorSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => {});

      // Act
      await service.generateMonthlyInvoices();

      // Assert
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error processing contract contract-1: Database connection failed'),
        expect.any(String),
      );

      loggerErrorSpy.mockRestore();
    });

    it('should skip a Contract and reset excludeFromNextBilling to false if excludeFromNextBilling is true', async () => {
      // Arrange
      const mockContract = createMockContract('contract-1', {
        excludeFromNextBilling: true,
        code: 'C-001',
      } as Partial<Contract>);

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      // Act
      await service.generateMonthlyInvoices();

      // Assert
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Contract,
        { id: mockContract.id },
        { excludeFromNextBilling: false },
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      // Should NOT call InvoiceGenerationService
      expect(mockInvoiceGenerationService.generateInvoiceForContract).not.toHaveBeenCalled();
    });

    it('should continue processing remaining contracts when one fails', async () => {
      // Arrange
      const contract1 = createMockContract('contract-1');
      const contract2 = createMockContract('contract-2');

      mockContractRepository.find
        .mockResolvedValueOnce([contract1, contract2])
        .mockResolvedValueOnce([]);

      mockInvoiceGenerationService.generateInvoiceForContract
        .mockRejectedValueOnce(new Error('Unexpected error'))
        .mockResolvedValueOnce({ id: 'invoice-2' });

      jest.spyOn(service['logger'], 'error').mockImplementation(() => {});

      // Act
      await service.generateMonthlyInvoices();

      // Assert - both contracts were attempted
      expect(mockInvoiceGenerationService.generateInvoiceForContract).toHaveBeenCalledTimes(2);
    });

    it('should skip contracts with NotFoundException (contract not found)', async () => {
      // Arrange
      const mockContract = createMockContract('contract-1');

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockInvoiceGenerationService.generateInvoiceForContract.mockRejectedValue(
        new NotFoundException('Contrato con ID contract-1 no encontrado'),
      );

      const loggerErrorSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => {});

      // Act
      await service.generateMonthlyInvoices();

      // Assert - logs error but doesn't crash
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error processing contract contract-1'),
        expect.any(String),
      );

      loggerErrorSpy.mockRestore();
    });
  });
});
