import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Contract, ContractStatus } from '../../contracts/entities/contract.entity';
import { ContractSuspensionCron } from './contract-suspension.cron';

describe('ContractSuspensionCron', () => {
  let service: ContractSuspensionCron;

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
        ContractSuspensionCron,
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

    service = module.get<ContractSuspensionCron>(ContractSuspensionCron);

    jest.clearAllMocks();
    mockQueryRunner.isTransactionActive = true;
  });

  const createMockContract = (
    id: string,
    code: string,
    cutoffDay: number = 5,
    titularName?: string,
  ): Contract => {
    const contractPersons = titularName
      ? [
          {
            isBillingOwner: true,
            role: 'TITULAR',
            person: { name: titularName },
          },
        ]
      : [];
    return {
      id,
      code,
      cutoffDay,
      status: ContractStatus.ACTIVE,
      contractPersons,
    } as unknown as Contract;
  };

  it('debe suspender un contrato activo si tiene facturas vencidas impagas', async () => {
    const contract = createMockContract('c-1', 'SIR-001-0001', 5, 'Juan Pérez');

    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]); // segunda página vacía

    mockQueryRunner.manager.count.mockResolvedValue(1);

    await service.processContractSuspensions();

    expect(mockQueryRunner.connect).toHaveBeenCalled();
    expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
    expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
      Contract,
      'c-1',
      expect.objectContaining({
        status: ContractStatus.SUSPENDED,
        inactivationReason: expect.stringContaining('corte de pago sin saldar (Día 5)'),
      }),
    );
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    expect(mockQueryRunner.release).toHaveBeenCalled();
  });

  it('no debe suspender el contrato si no tiene facturas vencidas impagas', async () => {
    const contract = createMockContract('c-2', 'SIR-001-0002', 15);

    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);

    mockQueryRunner.manager.count.mockResolvedValue(0);

    await service.processContractSuspensions();

    expect(mockQueryRunner.manager.update).not.toHaveBeenCalled();
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(mockQueryRunner.release).toHaveBeenCalled();
  });

  it('debe manejar errores de transacción y hacer rollback de forma segura', async () => {
    const contract = createMockContract('c-3', 'SIR-001-0003');

    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);

    mockQueryRunner.manager.count.mockRejectedValue(new Error('DB Connection Failed'));

    await service.processContractSuspensions();

    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(mockQueryRunner.release).toHaveBeenCalled();
  });
});
