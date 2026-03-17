import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { Plan } from '../../plans/entities/plan.entity';
import { InvoiceDetail } from '../entities/invoice-detail.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { BillingCronService } from './billing-cron.service';

describe('BillingCronService', () => {
  let service: BillingCronService;

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

  const mockContractRepository = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingCronService,
        {
          provide: getRepositoryToken(Contract),
          useValue: mockContractRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<BillingCronService>(BillingCronService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  // --- Helper Factories ---
  const createMockPlan = (amount: number): Plan => {
    return {
      id: 'plan-id',
      name: 'Test Plan',
      maxAge: 100,
      amount,
      persons: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: new Date(),
    } as Plan;
  };

  const createMockPerson = (
    id: string,
    planAmount: number,
    status: PersonStatus = PersonStatus.ACTIVE,
  ): Person => {
    return {
      id,
      identityCard: '12345678',
      name: `Person ${id}`,
      birthDate: new Date(),
      gender: true,
      plan: createMockPlan(planAmount),
      status,
      contract: {} as Contract,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: new Date(),
    } as Person;
  };

  const createMockContract = (id: string, persons: Person[]): Contract => {
    return {
      id,
      affiliationDate: new Date(),
      monthlyAmount: 0,
      status: ContractStatus.ACTIVE,
      persons,
      invoices: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: new Date(),
    } as Contract;
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateMonthlyInvoices', () => {
    it('should successfully generate Invoice and InvoiceDetail records for an ACTIVE Contract with ACTIVE Persons', async () => {
      // Arrange
      const mockPersons = [createMockPerson('person-1', 50), createMockPerson('person-2', 75)];
      const mockContract = createMockContract('contract-1', mockPersons);

      mockContractRepository.find
        .mockResolvedValueOnce([mockContract]) // First batch yields 1 contract
        .mockResolvedValueOnce([]); // Second batch yields empty array (end loop)

      mockQueryRunner.manager.findOne.mockResolvedValue(null); // Idempotency check: no existing invoice

      mockQueryRunner.manager.create.mockImplementation((entity, dto) => dto); // Mock create
      mockQueryRunner.manager.save.mockImplementation(async (entityOrArray) => entityOrArray); // Mock save

      // Act
      await service.generateMonthlyInvoices();

      // Assert
      expect(mockContractRepository.find).toHaveBeenCalledTimes(2);
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();

      // Verify idempotency check
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(
        Invoice,
        expect.objectContaining({
          where: expect.objectContaining({ contract: { id: mockContract.id } }),
        }),
      );

      // Verify Invoice creation (Total Amount calculation)
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        Invoice,
        expect.objectContaining({
          totalAmount: 125, // 50 + 75
          status: InvoiceStatus.PENDING,
          contract: mockContract,
        }),
      );

      // Verify InvoiceDetail creation
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        InvoiceDetail,
        expect.objectContaining({
          person: mockPersons[0],
          plan: mockPersons[0].plan,
          chargedAmount: 50,
        }),
      );
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        InvoiceDetail,
        expect.objectContaining({
          person: mockPersons[1],
          plan: mockPersons[1].plan,
          chargedAmount: 75,
        }),
      );

      expect(mockQueryRunner.manager.save).toHaveBeenCalledTimes(2); // Once for Invoice, once for array of InvoiceDetails
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should skip a Contract if an Invoice for the current month and year already exists (idempotency)', async () => {
      // Arrange
      const mockPersons = [createMockPerson('person-1', 50)];
      const mockContract = createMockContract('contract-1', mockPersons);

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockQueryRunner.manager.findOne.mockResolvedValue({ id: 'existing-invoice-id' }); // Simulate existing invoice

      // Act
      await service.generateMonthlyInvoices();

      // Assert
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalled(); // Looked up existing

      // Crucially, it should rollback and NOT save anything
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.create).not.toHaveBeenCalled();
      expect(mockQueryRunner.manager.save).not.toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should correctly call rollbackTransaction if an error is thrown during saving', async () => {
      // Arrange
      const mockPersons = [createMockPerson('person-1', 50)];
      const mockContract = createMockContract('contract-1', mockPersons);

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockQueryRunner.manager.findOne.mockResolvedValue(null);
      mockQueryRunner.manager.create.mockImplementation((entity, dto) => dto);

      // Simulate error during save
      const mockError = new Error('Database connection failed');
      mockQueryRunner.manager.save.mockRejectedValue(mockError);

      // We spy on logger to avoid test output noise, but also to verify it caught the error
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => {});

      // Act
      await service.generateMonthlyInvoices();

      // Assert
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error processing contract contract-1: Database connection failed'),
        expect.any(String), // Stack trace
      );

      loggerErrorSpy.mockRestore();
    });

    it('should skip an ACTIVE Contract if it has no ACTIVE Persons', async () => {
      // Arrange
      const mockPersons = [
        createMockPerson('person-1', 50, PersonStatus.INACTIVE), // INACTIVE person
      ];
      const mockContract = createMockContract('contract-1', mockPersons);

      mockContractRepository.find.mockResolvedValueOnce([mockContract]).mockResolvedValueOnce([]);

      mockQueryRunner.manager.findOne.mockResolvedValue(null);

      // Act
      await service.generateMonthlyInvoices();

      // Assert
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      // Should rollback and NOT save anything since no active persons
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.create).not.toHaveBeenCalled();
      expect(mockQueryRunner.manager.save).not.toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });
});
