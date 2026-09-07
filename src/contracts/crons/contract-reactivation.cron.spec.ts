import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractsService } from '../services/contracts.service';
import { ContractReactivationCron } from './contract-reactivation.cron';

describe('ContractReactivationCron', () => {
  let service: ContractReactivationCron;

  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    isTransactionActive: true,
    release: jest.fn(),
    manager: {
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockContractRepository = {
    find: jest.fn(),
  };

  const mockContractsService = {
    activate: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractReactivationCron,
        {
          provide: getRepositoryToken(Contract),
          useValue: mockContractRepository,
        },
        {
          provide: ContractsService,
          useValue: mockContractsService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<ContractReactivationCron>(ContractReactivationCron);

    jest.clearAllMocks();
    mockQueryRunner.isTransactionActive = true;
    mockQueryBuilder.getCount.mockResolvedValue(0);
    mockQueryRunner.manager.count.mockResolvedValue(0);
  });

  const createMockContract = (
    id: string,
    code: string,
    titularName: string = 'Juan Pérez',
  ): Contract => {
    const contractPersons = [
      {
        isBillingOwner: true,
        role: 'TITULAR',
        person: { name: titularName },
      },
    ];
    return {
      id,
      code,
      status: ContractStatus.SUSPENDED,
      reactivationEligibleAt: new Date('2026-09-01'),
      contractPersons,
    } as unknown as Contract;
  };

  it('should reactivate a contract when it is 100% solvent and has no processing payments', async () => {
    const contract = createMockContract('c-1', 'SIR-001');

    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);

    mockQueryRunner.manager.count.mockResolvedValue(0); // 0 facturas vencidas impagas
    mockQueryBuilder.getCount.mockResolvedValue(0); // 0 pagos en PROCESSING

    await service.processContractReactivations();

    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    expect(mockContractsService.activate).toHaveBeenCalledWith('c-1');
  });

  it('should not reactivate a contract if it still has payments in PROCESSING', async () => {
    const contract = createMockContract('c-1', 'SIR-001');

    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);

    mockQueryRunner.manager.count.mockResolvedValue(0);
    mockQueryBuilder.getCount.mockResolvedValue(1); // 1 pago aún en PROCESSING

    await service.processContractReactivations();

    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(mockContractsService.activate).not.toHaveBeenCalled();
  });

  it('should reset reactivationEligibleAt to null if contract has overdue invoices and no processing payments', async () => {
    const contract = createMockContract('c-1', 'SIR-001');

    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);

    mockQueryRunner.manager.count.mockResolvedValue(2); // 2 facturas impagas
    mockQueryBuilder.getCount.mockResolvedValue(0); // Sin pagos en processing

    await service.processContractReactivations();

    expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(Contract, 'c-1', {
      reactivationEligibleAt: null,
    });
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    expect(mockContractsService.activate).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully during evaluation', async () => {
    const contract = createMockContract('c-err', 'SIR-ERR');

    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);

    mockQueryRunner.manager.count.mockRejectedValue(new Error('DB Connection Timeout'));

    await service.processContractReactivations();

    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(mockContractsService.activate).not.toHaveBeenCalled();
  });
});
