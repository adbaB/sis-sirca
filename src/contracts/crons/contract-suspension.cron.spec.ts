import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractSuspensionCron } from './contract-suspension.cron';
import { getCaracasNow } from '../../common/utils/date.util';
import { InvoiceStatus } from '../../billing/invoices/entities/invoice.entity';

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
      findOne: jest.fn(),
      find: jest.fn(),
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
    mockQueryRunner.manager.findOne.mockImplementation(async (_entity, options) => {
      const id = options?.where?.id ?? 'c-1';
      return { id, code: 'SIR-001', cutoffDay: 5, status: ContractStatus.ACTIVE } as Contract;
    });
    mockQueryRunner.manager.find.mockResolvedValue([]);
    mockQueryRunner.manager.count.mockResolvedValue(0);
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
    const now = getCaracasNow();
    const contract = createMockContract('c-1', 'SIR-001-0001', 5, 'Juan Pérez');
    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);
    mockQueryRunner.manager.findOne.mockResolvedValue(contract);
    mockQueryRunner.manager.find.mockResolvedValue([
      {
        totalAmount: 100,
        paidAmount: 0,
        retentionAmount: 0,
        status: InvoiceStatus.PENDING,
        dueDate: now.minus({ days: 1 }).toJSDate(),
      },
    ]);

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
    mockQueryRunner.manager.findOne.mockResolvedValue(contract);
    mockQueryRunner.manager.count.mockResolvedValue(0);

    await service.processContractSuspensions();

    expect(mockQueryRunner.manager.update).not.toHaveBeenCalled();
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(mockQueryRunner.release).toHaveBeenCalled();
  });

  it('no debe suspender en el propio día de corte (now.day === cutoffDay) si la factura es del mes actual', async () => {
    const now = getCaracasNow();
    const contract = createMockContract('c-cutoff', 'SIR-CUTOFF', now.day);
    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);
    mockQueryRunner.manager.findOne.mockResolvedValue(contract);

    // Factura del mes actual con vencimiento hoy
    mockQueryRunner.manager.find.mockResolvedValue([
      {
        totalAmount: 100,
        paidAmount: 0,
        retentionAmount: 0,
        status: InvoiceStatus.PENDING,
        dueDate: now.toJSDate(),
      },
    ]);

    await service.processContractSuspensions();

    expect(mockQueryRunner.manager.update).not.toHaveBeenCalled();
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('debe suspender al día siguiente del corte (now.day > cutoffDay) con factura vencida del mes actual', async () => {
    const now = getCaracasNow();
    // cutoffDay es ayer (o día 1 si today es >= 2)
    const cutoffDay = Math.max(1, now.day - 1);
    const contract = createMockContract('c-after', 'SIR-AFTER', cutoffDay, 'Carlos');
    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);
    mockQueryRunner.manager.findOne.mockResolvedValue(contract);

    mockQueryRunner.manager.find.mockResolvedValue([
      {
        totalAmount: 100,
        paidAmount: 0,
        retentionAmount: 0,
        status: InvoiceStatus.PENDING,
        dueDate: now.minus({ days: 1 }).toJSDate(),
      },
    ]);

    await service.processContractSuspensions();

    // Solo corre si hoy es posterior al corte (true si now.day > 1)
    if (now.day > cutoffDay) {
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Contract,
        'c-after',
        expect.objectContaining({
          status: ContractStatus.SUSPENDED,
        }),
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    }
  });

  it('debe suspender si existe una factura vencida de un mes anterior aunque hoy sea antes del corte', async () => {
    const now = getCaracasNow();
    // cutoffDay a fin de mes (e.g. 28)
    const contract = createMockContract('c-prior', 'SIR-PRIOR', 28, 'Maria');
    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);
    mockQueryRunner.manager.findOne.mockResolvedValue(contract);

    // Factura de hace un mes
    mockQueryRunner.manager.find.mockResolvedValue([
      {
        totalAmount: 100,
        paidAmount: 0,
        retentionAmount: 0,
        status: InvoiceStatus.PENDING,
        dueDate: now.minus({ months: 1 }).toJSDate(),
      },
    ]);

    await service.processContractSuspensions();

    expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
      Contract,
      'c-prior',
      expect.objectContaining({
        status: ContractStatus.SUSPENDED,
      }),
    );
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('no debe suspender si el contrato ya no está ACTIVE al intentar el bloqueo (condición de carrera)', async () => {
    const contract = createMockContract('c-race', 'SIR-RACE', 5);
    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);
    // Simular que entre la consulta inicial y el lock, el contrato ya no está ACTIVE
    mockQueryRunner.manager.findOne.mockResolvedValue(null);

    await service.processContractSuspensions();

    expect(mockQueryRunner.manager.update).not.toHaveBeenCalled();
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('no debe suspender si la factura vencida ya fue saldada en su totalidad', async () => {
    const now = getCaracasNow();
    const contract = createMockContract('c-paid', 'SIR-PAID', Math.max(1, now.day - 1));
    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);
    mockQueryRunner.manager.findOne.mockResolvedValue(contract);

    // Factura con saldo remanente 0
    mockQueryRunner.manager.find.mockResolvedValue([
      {
        totalAmount: 100,
        paidAmount: 100,
        retentionAmount: 0,
        status: InvoiceStatus.PARTIAL,
        dueDate: now.minus({ days: 1 }).toJSDate(),
      },
    ]);

    await service.processContractSuspensions();

    expect(mockQueryRunner.manager.update).not.toHaveBeenCalled();
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('debe manejar errores de transacción y hacer rollback de forma segura', async () => {
    const contract = createMockContract('c-3', 'SIR-001-0003');
    mockContractRepository.find.mockResolvedValueOnce([contract]).mockResolvedValueOnce([]);
    mockQueryRunner.manager.count.mockRejectedValue(new Error('DB Connection Failed'));
    mockQueryRunner.manager.find.mockRejectedValue(new Error('DB Connection Failed'));

    await service.processContractSuspensions();

    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(mockQueryRunner.release).toHaveBeenCalled();
  });
});
