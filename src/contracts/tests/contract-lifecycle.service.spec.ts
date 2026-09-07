import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractLifecycleService } from '../services/contract-lifecycle.service';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { PersonStatus } from '../../persons/entities/person.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';
import { Invoice } from '../../billing/invoices/entities/invoice.entity';
import { Role } from '../../roles/entities/role.entity';

describe('ContractLifecycleService', () => {
  let service: ContractLifecycleService;
  let contractsRepository: jest.Mocked<Repository<Contract>>;
  let mockManager: Record<string, unknown>;
  let mockQr: Record<string, unknown>;

  const mockContract: Contract = {
    id: 'contract-1',
    code: 'SIR-001-00001',
    status: ContractStatus.ACTIVE,
    monthlyAmount: 100,
    retentionPercentage: 0,
    advisorCommission: 0,
    excludeFromNextBilling: false,
    affiliationDate: new Date('2026-08-01'),
    cutoffDay: 5,
    inactivationReason: null as unknown as string,
    reactivationEligibleAt: null,
    contractPersons: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null as unknown as Date,
  };

  beforeEach(async () => {
    mockManager = {
      getRepository: jest.fn(),
    };

    mockQr = {
      isTransactionActive: false,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockImplementation(async () => {
        mockQr.isTransactionActive = true;
      }),
      commitTransaction: jest.fn().mockImplementation(async () => {
        mockQr.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn().mockImplementation(async () => {
        mockQr.isTransactionActive = false;
      }),
      release: jest.fn().mockResolvedValue(undefined),
      manager: mockManager,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractLifecycleService,
        {
          provide: getRepositoryToken(Contract),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ContractPerson),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AffiliationHistory),
          useValue: {
            find: jest.fn(),
            save: jest.fn(),
            create: jest.fn().mockImplementation((val) => val),
            remove: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(mockQr),
          },
        },
      ],
    }).compile();

    service = module.get<ContractLifecycleService>(ContractLifecycleService);
    contractsRepository = module.get(getRepositoryToken(Contract));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('should return contract if found', async () => {
      contractsRepository.findOne.mockResolvedValue(mockContract);
      const res = await service.findOne('contract-1');
      expect(res).toEqual(mockContract);
    });

    it('should throw NotFoundException if not found', async () => {
      contractsRepository.findOne.mockResolvedValue(null);
      await expect(service.findOne('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByCode', () => {
    it('should find by code or legacyCode', async () => {
      contractsRepository.findOne.mockResolvedValue(mockContract);
      const res = await service.findByCode('  SIR-001-00001  ');
      expect(contractsRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [{ code: 'SIR-001-00001' }, { legacyCode: 'SIR-001-00001' }],
        }),
      );
      expect(res).toEqual(mockContract);
    });
  });

  describe('update', () => {
    it('should update contract properties and save', async () => {
      contractsRepository.findOne.mockResolvedValue({ ...mockContract });
      contractsRepository.save.mockImplementation(async (c) => c as Contract);

      const dto: UpdateContractDto = { retentionPercentage: 5, advisorId: 'adv-2' };
      const res = await service.update('contract-1', dto);

      expect(res.retentionPercentage).toBe(5);
      expect(res.advisor).toEqual({ id: 'adv-2' });
      expect(contractsRepository.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft remove contract', async () => {
      contractsRepository.findOne.mockResolvedValue(mockContract);
      contractsRepository.softRemove.mockResolvedValue(mockContract);

      await service.remove('contract-1');
      expect(contractsRepository.softRemove).toHaveBeenCalledWith(mockContract);
    });
  });

  describe('inactivate', () => {
    it('should throw if already inactive', async () => {
      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue({
              ...mockContract,
              status: ContractStatus.INACTIVE,
            }),
          };
        }
        return {};
      });

      await expect(service.inactivate('contract-1', { reason: 'Mora' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if contract not found', async () => {
      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(null),
          };
        }
        return {};
      });

      await expect(service.inactivate('contract-1', { reason: 'Mora' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should inactivate active contract in a transaction', async () => {
      const mockLockedContract = { ...mockContract };
      const mockActivePersons = [
        {
          id: 'cp-1',
          role: PersonRole.AFILIADO,
          person: { id: 'p-1', name: 'Pedro', plan: { amount: 50 } },
        },
      ];

      const mockCpFind = jest.fn().mockResolvedValue(mockActivePersons);

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(mockLockedContract),
            save: jest.fn().mockImplementation(async (c) => c),
          };
        }
        if (target === ContractPerson) {
          return {
            find: mockCpFind,
          };
        }
        if (target === AffiliationHistory) {
          return {
            create: jest.fn().mockImplementation((val) => val),
            save: jest.fn().mockResolvedValue(true),
          };
        }
        return {};
      });

      const dto: InactivateContractDto = { reason: 'Falta de pago' };
      const res = await service.inactivate('contract-1', dto);

      expect(res.status).toBe(ContractStatus.INACTIVE);
      expect(res.inactivationReason).toBe('Falta de pago');
      expect(mockCpFind).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            contract: { id: 'contract-1' },
            role: PersonRole.AFILIADO,
            person: { status: PersonStatus.ACTIVE },
          },
        }),
      );
    });
  });

  describe('activate', () => {
    it('should throw if already active', async () => {
      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue({
              ...mockContract,
              status: ContractStatus.ACTIVE,
            }),
          };
        }
        return {};
      });

      await expect(service.activate('contract-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if contract not found on activate', async () => {
      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(null),
          };
        }
        return {};
      });

      await expect(service.activate('contract-1')).rejects.toThrow(NotFoundException);
    });

    it('should activate a SUSPENDED contract directly when eligible and solvent', async () => {
      const mockLockedContract = {
        ...mockContract,
        status: ContractStatus.SUSPENDED,
        inactivationReason: 'Suspendido por falta de pago al corte',
        reactivationEligibleAt: new Date('2026-01-01'), // Plazo cumplido
      };

      const mockHistoryRepo = {
        find: jest.fn(),
      };
      const mockInvoiceRepo = {
        count: jest.fn().mockResolvedValue(0), // Solvente
      };

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(mockLockedContract),
            save: jest.fn().mockImplementation(async (c) => c),
          };
        }
        if (target === AffiliationHistory) {
          return mockHistoryRepo;
        }
        if (target === Invoice) {
          return mockInvoiceRepo;
        }
        return {};
      });

      const res = await service.activate('contract-1');
      expect(res.status).toBe(ContractStatus.ACTIVE);
      expect(res.inactivationReason).toBeNull();
      expect(res.reactivationEligibleAt).toBeNull();
      expect(mockHistoryRepo.find).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if SUSPENDED contract is in 7-day cooldown without override permission', async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const mockLockedContract = {
        ...mockContract,
        status: ContractStatus.SUSPENDED,
        inactivationReason: 'Suspendido por corte',
        reactivationEligibleAt: futureDate,
      };

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(mockLockedContract),
          };
        }
        if (target === Invoice) {
          return { count: jest.fn().mockResolvedValue(0) };
        }
        return {};
      });

      await expect(service.activate('contract-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if SUSPENDED contract has overdue invoices without override permission', async () => {
      const pastDate = new Date('2026-01-01');
      const mockLockedContract = {
        ...mockContract,
        status: ContractStatus.SUSPENDED,
        inactivationReason: 'Suspendido por corte',
        reactivationEligibleAt: pastDate,
      };

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(mockLockedContract),
          };
        }
        if (target === Invoice) {
          return { count: jest.fn().mockResolvedValue(2) }; // 2 facturas impagas
        }
        return {};
      });

      await expect(service.activate('contract-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if override permission is used for bypass without providing reason', async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const mockLockedContract = {
        ...mockContract,
        status: ContractStatus.SUSPENDED,
        inactivationReason: 'Suspendido por corte',
        reactivationEligibleAt: futureDate,
      };

      const mockRoleRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'role-admin',
          permissions: [{ name: 'override:contract-reactivation' }],
        }),
      };

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(mockLockedContract),
          };
        }
        if (target === Invoice) {
          return { count: jest.fn().mockResolvedValue(0) };
        }
        if (target === Role) {
          return mockRoleRepo;
        }
        return {};
      });

      // Sin motivo
      await expect(
        service.activate('contract-1', undefined, { userId: 'u-1', roleId: 'role-admin' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully bypass cooldown and debt when user has override:contract-reactivation and provides reason', async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const mockLockedContract = {
        ...mockContract,
        status: ContractStatus.SUSPENDED,
        inactivationReason: 'Suspendido por corte',
        reactivationEligibleAt: futureDate,
      };

      const mockRoleRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'role-admin',
          permissions: [{ name: 'override:contract-reactivation' }],
        }),
      };

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(mockLockedContract),
            save: jest.fn().mockImplementation(async (c) => c),
          };
        }
        if (target === Invoice) {
          return { count: jest.fn().mockResolvedValue(1) }; // Tiene deuda
        }
        if (target === Role) {
          return mockRoleRepo;
        }
        return {};
      });

      const res = await service.activate(
        'contract-1',
        { reason: 'Excepción médica autorizada por dirección' },
        { userId: 'u-1', roleId: 'role-admin' },
      );

      expect(res.status).toBe(ContractStatus.ACTIVE);
      expect(res.inactivationReason).toBeNull();
      expect(res.reactivationEligibleAt).toBeNull();
    });

    it('should revert same-month disaffiliations when activated in the same month', async () => {
      const mockLockedContract = { ...mockContract, status: ContractStatus.INACTIVE };
      const now = new Date();
      const mockHistoryList = [{ id: 'h-1', actionDate: now, createdAt: now }];

      const mockHistoryRepo = {
        find: jest.fn().mockResolvedValue(mockHistoryList),
        save: jest.fn().mockImplementation(async (records) => records),
      };

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(mockLockedContract),
            save: jest.fn().mockImplementation(async (c) => c),
          };
        }
        if (target === AffiliationHistory) {
          return mockHistoryRepo;
        }
        return {};
      });

      const res = await service.activate('contract-1');
      expect(res.status).toBe(ContractStatus.ACTIVE);
      expect(res.inactivationReason).toBeNull();
      expect(mockHistoryRepo.save).toHaveBeenCalled();
      const savedRecords = mockHistoryRepo.save.mock.calls[0][0];
      expect(savedRecords[0].isReverted).toBe(true);
      expect(savedRecords[0].revertedAt).toBeInstanceOf(Date);
    });

    it('should not revert past-month disaffiliations and record new AFILIACION when activated in a later month', async () => {
      const mockLockedContract = { ...mockContract, status: ContractStatus.INACTIVE };
      const pastDate = new Date('2025-01-15');
      const mockHistoryList = [
        { id: 'h-old', actionDate: pastDate, createdAt: pastDate, isReverted: false },
      ];

      const mockHistoryRepo = {
        find: jest.fn().mockResolvedValue(mockHistoryList),
        create: jest.fn().mockImplementation((dto) => dto),
        save: jest.fn().mockImplementation(async (records) => records),
      };

      const mockActiveCp = {
        contract: mockLockedContract,
        person: { id: 'person-1', name: 'Pedro' },
        plan: { id: 'plan-1', amount: 30 },
        role: PersonRole.AFILIADO,
      };

      const mockCpRepo = {
        find: jest.fn().mockResolvedValue([mockActiveCp]),
      };

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(mockLockedContract),
            save: jest.fn().mockImplementation(async (c) => c),
          };
        }
        if (target === AffiliationHistory) {
          return mockHistoryRepo;
        }
        if (target === ContractPerson) {
          return mockCpRepo;
        }
        return {};
      });

      const res = await service.activate('contract-1');
      expect(res.status).toBe(ContractStatus.ACTIVE);
      expect(mockHistoryList[0].isReverted).toBe(false);
      expect(mockHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AffiliationAction.AFILIACION,
          reason: 'Reactivación de contrato',
          amount: 30,
        }),
      );
      expect(mockHistoryRepo.save).toHaveBeenCalled();
    });
  });

  describe('setAdvisor', () => {
    it('should save contract with new advisor', async () => {
      contractsRepository.save.mockResolvedValue(mockContract);
      await service.setAdvisor('contract-1', 'adv-99');
      expect(contractsRepository.save).toHaveBeenCalledWith({
        id: 'contract-1',
        advisor: { id: 'adv-99' },
      });
    });
  });

  describe('syncReactivationEligibility', () => {
    it('should return null if contract is not suspended', async () => {
      const mockActive = { ...mockContract, status: ContractStatus.ACTIVE };
      const em = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(mockActive),
          save: jest.fn(),
        }),
        find: jest.fn(),
      };

      const result = await service.syncReactivationEligibility(
        'contract-1',
        em as unknown as EntityManager,
      );
      expect(result).toBeNull();
    });

    it('should compute 7 days from latest payment operation_date when overdue invoices are covered by PROCESSING payments', async () => {
      const mockSuspended = {
        ...mockContract,
        status: ContractStatus.SUSPENDED,
        reactivationEligibleAt: null,
      };

      const opDate = new Date('2026-09-01T10:00:00Z');
      const mockInvoices = [
        {
          id: 'inv-1',
          totalAmount: 100,
          retentionAmount: 0,
          paidAmount: 0,
          status: 'PENDING',
          dueDate: new Date('2026-08-15'), // Vencida
          payments: [
            {
              id: 'p-1',
              status: 'PROCESSING',
              amount: 100,
              operationDate: opDate,
              paymentDate: opDate,
            },
          ],
        },
      ];

      const saveMock = jest.fn().mockImplementation(async (c) => c);
      const em = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(mockSuspended),
          save: saveMock,
        }),
        find: jest.fn().mockResolvedValue(mockInvoices),
      };

      const result = await service.syncReactivationEligibility(
        'contract-1',
        em as unknown as EntityManager,
      );
      expect(result).toBeInstanceOf(Date);
      expect(saveMock).toHaveBeenCalled();
      expect(mockSuspended.reactivationEligibleAt).toBeInstanceOf(Date);
    });

    it('should set reactivationEligibleAt to null when overdue invoices are not covered', async () => {
      const mockSuspended = {
        ...mockContract,
        status: ContractStatus.SUSPENDED,
        reactivationEligibleAt: new Date(),
      };

      const mockInvoices = [
        {
          id: 'inv-1',
          totalAmount: 100,
          retentionAmount: 0,
          paidAmount: 0,
          status: 'PENDING',
          dueDate: new Date('2026-08-15'), // Vencida
          payments: [], // Sin pagos
        },
      ];

      const saveMock = jest.fn().mockImplementation(async (c) => c);
      const em = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(mockSuspended),
          save: saveMock,
        }),
        find: jest.fn().mockResolvedValue(mockInvoices),
      };

      const result = await service.syncReactivationEligibility(
        'contract-1',
        em as unknown as EntityManager,
      );
      expect(result).toBeNull();
      expect(mockSuspended.reactivationEligibleAt).toBeNull();
    });
  });
});
