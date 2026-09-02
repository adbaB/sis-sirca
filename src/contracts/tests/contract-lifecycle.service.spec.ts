import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractLifecycleService } from '../services/contract-lifecycle.service';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';

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
    inactivationReason: null as unknown as string,
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
      const res = await service.findByCode('SIR-001-00001');
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
      contractsRepository.findOne.mockResolvedValue({
        ...mockContract,
        status: ContractStatus.INACTIVE,
      });

      await expect(service.inactivate('contract-1', { reason: 'Mora' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should inactivate active contract in a transaction', async () => {
      contractsRepository.findOne.mockResolvedValue({ ...mockContract });

      const mockLockedContract = { ...mockContract };
      const mockActivePersons = [
        {
          id: 'cp-1',
          role: PersonRole.AFILIADO,
          person: { id: 'p-1', name: 'Pedro', plan: { amount: 50 } },
        },
      ];

      mockManager.getRepository = jest.fn().mockImplementation((target) => {
        if (target === Contract) {
          return {
            findOne: jest.fn().mockResolvedValue(mockLockedContract),
            save: jest.fn().mockImplementation(async (c) => c),
          };
        }
        if (target === ContractPerson) {
          return {
            find: jest.fn().mockResolvedValue(mockActivePersons),
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
    });
  });

  describe('activate', () => {
    it('should throw if already active', async () => {
      contractsRepository.findOne.mockResolvedValue({
        ...mockContract,
        status: ContractStatus.ACTIVE,
      });

      await expect(service.activate('contract-1')).rejects.toThrow(BadRequestException);
    });

    it('should activate inactive contract in a transaction', async () => {
      contractsRepository.findOne.mockResolvedValue({
        ...mockContract,
        status: ContractStatus.INACTIVE,
      });

      const mockLockedContract = { ...mockContract, status: ContractStatus.INACTIVE };
      const mockHistoryList = [{ id: 'h-1', actionDate: new Date(), createdAt: new Date() }];

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
      expect(mockHistoryRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          reason: expect.stringMatching(/^REVERTIDO:/),
        }),
      ]);
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
});
