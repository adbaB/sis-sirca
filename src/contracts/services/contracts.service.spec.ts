import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Repository,
  SelectQueryBuilder,
  EntityManager,
  ObjectLiteral,
  EntityTarget,
} from 'typeorm';

import { Person, PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { Plan } from '../../plans/entities/plan.entity';
import { CreateContractDto } from '../dto/create-contract.dto';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractsService } from './contracts.service';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { BillingService } from '../../billing/services/billing.service';
import { PlansService } from '../../plans/services/plans.service';
import { PdfService } from '../../pdf/services/pdf.service';
import { AwsService } from '../../aws/aws.service';

describe('ContractsService', () => {
  let service: ContractsService;
  let repository: Repository<Contract>;
  let contractPersonsRepository: Repository<ContractPerson>;

  const mockContract: Contract = {
    id: '1',
    code: '1',
    affiliationDate: new Date('2023-01-01'),
    monthlyAmount: 0,
    retentionPercentage: 0,
    contractPersons: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    status: ContractStatus.ACTIVE,
    inactivationReason: null,
  };

  const CONTRACTS_REPOSITORY_TOKEN = getRepositoryToken(Contract);
  const CONTRACT_PERSONS_REPOSITORY_TOKEN = getRepositoryToken(ContractPerson);
  const AFFILIATION_HISTORY_REPOSITORY_TOKEN = getRepositoryToken(AffiliationHistory);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        {
          provide: PersonsService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: BillingService,
          useValue: {
            removeAffiliateLineFromActiveInvoice: jest.fn(),
          },
        },
        {
          provide: PlansService,
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: PdfService,
          useValue: {
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
          },
        },
        {
          provide: AwsService,
          useValue: {
            uploadFile: jest
              .fn()
              .mockResolvedValue('https://mock-s3-url.com/contracts/SIR-001.pdf'),
          },
        },
        {
          provide: CONTRACTS_REPOSITORY_TOKEN,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
            findAndCount: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
            manager: {
              transaction: jest.fn(),
            },
          },
        },
        {
          provide: CONTRACT_PERSONS_REPOSITORY_TOKEN,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: AFFILIATION_HISTORY_REPOSITORY_TOKEN,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    repository = module.get<Repository<Contract>>(CONTRACTS_REPOSITORY_TOKEN);
    contractPersonsRepository = module.get<Repository<ContractPerson>>(
      CONTRACT_PERSONS_REPOSITORY_TOKEN,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully insert a contract', async () => {
      const createContractDto: CreateContractDto = {
        affiliationDate: '2023-01-01',
        code: '1',
      };

      jest.spyOn(repository, 'findOne').mockResolvedValue(null);
      jest.spyOn(repository, 'create').mockReturnValue(mockContract);
      jest.spyOn(repository, 'save').mockResolvedValue(mockContract);

      const result = await service.create(createContractDto);

      expect(repository.findOne).toHaveBeenCalledWith({ where: { code: '1' } });
      expect(repository.create).toHaveBeenCalledWith(createContractDto);
      expect(repository.save).toHaveBeenCalledWith(mockContract);
      expect(result).toEqual(mockContract);
    });

    it('should throw BadRequestException if contract code already exists', async () => {
      const createContractDto: CreateContractDto = {
        affiliationDate: '2023-01-01',
        code: '1',
      };

      jest.spyOn(repository, 'findOne').mockResolvedValue(mockContract);

      await expect(service.create(createContractDto)).rejects.toThrow(
        'El código de contrato "1" ya está registrado.',
      );
    });
  });

  describe('findAll', () => {
    it('should return a paginated result of contracts', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockContract], 1]),
      };

      jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as unknown as SelectQueryBuilder<Contract>);

      const result = await service.findAll({});

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('contract');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalled();
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('contract.code', 'ASC');
      expect(result).toEqual({
        data: [mockContract],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });
    });

    it('should apply search filter when search param is provided', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as unknown as SelectQueryBuilder<Contract>);

      await service.findAll({ search: 'test' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE :search'),
        { search: '%test%' },
      );
    });

    it('should apply advisor filter when advisorId is provided', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as unknown as SelectQueryBuilder<Contract>);

      const advisorId = '123e4567-e89b-12d3-a456-426614174000';
      await service.findAll({ advisorId });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('contract.advisor_id = :advisorId', {
        advisorId,
      });
    });
  });

  describe('findOne', () => {
    it('should return a contract if it exists', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockContract);

      const result = await service.findOne('1');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        relations: [
          'contractPersons',
          'contractPersons.person',
          'contractPersons.person.plan',
          'invoices',
          'invoices.payments',
          'surpluses',
          'surpluses.payment',
          'advisor',
          'portfolio',
        ],
      });
      expect(result).toEqual(mockContract);
    });

    it('should throw NotFoundException if contract does not exist', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await expect(service.findOne('2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return a contract', async () => {
      const updateContractDto: UpdateContractDto = { affiliationDate: '2023-02-01' };
      const updatedContract = {
        ...mockContract,
        ...updateContractDto,
        affiliationDate: new Date('2023-02-01'),
      };

      jest.spyOn(service, 'findOne').mockResolvedValue(mockContract);
      jest.spyOn(repository, 'save').mockResolvedValue(updatedContract as Contract);

      const result = await service.update('1', updateContractDto);

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(repository.save).toHaveBeenCalled();
      expect(result.affiliationDate.toISOString()).toContain('2023-02-01');
    });

    it('should update and associate advisorId and portfolioId', async () => {
      const updateContractDto: UpdateContractDto = {
        advisorId: 'adv-1',
        portfolioId: 'port-1',
      };
      const updatedContract = {
        ...mockContract,
        advisor: { id: 'adv-1' },
        portfolio: { id: 'port-1' },
      };

      jest.spyOn(service, 'findOne').mockResolvedValue(mockContract);
      jest.spyOn(repository, 'save').mockResolvedValue(updatedContract as unknown as Contract);

      const result = await service.update('1', updateContractDto);

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          advisor: { id: 'adv-1' },
          portfolio: { id: 'port-1' },
        }),
      );
      expect(result.advisor).toEqual({ id: 'adv-1' });
      expect(result.portfolio).toEqual({ id: 'port-1' });
    });

    it('should detach advisorId and portfolioId when they are null', async () => {
      const updateContractDto: UpdateContractDto = {
        advisorId: null,
        portfolioId: null,
      };
      const updatedContract = {
        ...mockContract,
        advisor: null,
        portfolio: null,
      };

      jest.spyOn(service, 'findOne').mockResolvedValue(mockContract);
      jest.spyOn(repository, 'save').mockResolvedValue(updatedContract as unknown as Contract);

      const result = await service.update('1', updateContractDto);

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          advisor: null,
          portfolio: null,
        }),
      );
      expect(result.advisor).toBeNull();
      expect(result.portfolio).toBeNull();
    });

    it('should throw BadRequestException if update code is already used by another contract', async () => {
      const updateContractDto: UpdateContractDto = {
        code: 'existing-code',
      };

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: '2', code: 'existing-code' }), // Different ID ('2') than updated contract ('1')
      };

      jest.spyOn(service, 'findOne').mockResolvedValue(mockContract);
      jest
        .spyOn(repository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as unknown as SelectQueryBuilder<Contract>);

      await expect(service.update('1', updateContractDto)).rejects.toThrow(
        'El código de contrato "existing-code" ya está registrado en otro contrato.',
      );
    });
  });

  describe('remove', () => {
    it('should soft remove a contract', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockContract);
      jest.spyOn(repository, 'softRemove').mockResolvedValue(mockContract);

      await service.remove('1');

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(repository.softRemove).toHaveBeenCalledWith(mockContract);
    });
  });

  describe('recalculateMonthlyAmount', () => {
    it('should accurately calculate the amount based on associated persons plans', async () => {
      const mockPlan1 = { amount: 10 } as Plan;
      const mockPlan2 = { amount: 20 } as Plan;

      const mockPerson1 = { plan: mockPlan1 } as Person;
      const mockPerson2 = { plan: mockPlan2 } as Person;
      const mockPersonWithoutPlan = { plan: null } as Person;

      const mockAffiliates = [
        { role: 'AFILIADO', person: mockPerson1 },
        { role: 'AFILIADO', person: mockPerson2 },
        { role: 'TITULAR', person: mockPersonWithoutPlan }, // should not be counted even if it had a plan
      ];

      jest
        .spyOn(contractPersonsRepository, 'find')
        .mockResolvedValue(mockAffiliates as ContractPerson[]);
      jest
        .spyOn(repository, 'update')
        .mockResolvedValue(undefined as unknown as import('typeorm').UpdateResult);

      await service.recalculateMonthlyAmount('1');

      expect(contractPersonsRepository.find).toHaveBeenCalledWith({
        where: {
          contract: { id: '1' },
          person: { status: PersonStatus.ACTIVE },
        },
        relations: ['person', 'person.plan'],
      });
      expect(repository.update).toHaveBeenCalledWith('1', { monthlyAmount: 30 }); // 10 + 20
    });

    it('should gracefully handle an invalid contract id', async () => {
      jest.spyOn(contractPersonsRepository, 'find').mockResolvedValue([]);
      jest
        .spyOn(repository, 'update')
        .mockResolvedValue(undefined as unknown as import('typeorm').UpdateResult);

      await service.recalculateMonthlyAmount('invalid-id');

      expect(contractPersonsRepository.find).toHaveBeenCalledWith({
        where: {
          contract: { id: 'invalid-id' },
          person: { status: PersonStatus.ACTIVE },
        },
        relations: ['person', 'person.plan'],
      });
      expect(repository.update).toHaveBeenCalledWith('invalid-id', { monthlyAmount: 0 });
    });
  });

  describe('createFull', () => {
    let mockManager: Partial<EntityManager>;
    let mockPersonRepo: {
      findOne: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    };
    let mockContractRepo: {
      create: jest.Mock;
      save: jest.Mock;
      findOne: jest.Mock;
      update: jest.Mock;
    };
    let mockCpRepo: {
      find: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
      softRemove: jest.Mock;
    };
    let mockHistoryRepo: {
      create: jest.Mock;
      save: jest.Mock;
    };

    beforeEach(() => {
      mockPersonRepo = {
        findOne: jest.fn(),
        create: jest.fn().mockImplementation((d) => ({ id: 'new-person-id', ...d })),
        save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      };
      mockContractRepo = {
        create: jest.fn().mockReturnValue(mockContract),
        save: jest.fn().mockResolvedValue(mockContract),
        findOne: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockResolvedValue(undefined),
      };
      mockCpRepo = {
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation((cp) => cp),
        save: jest.fn().mockImplementation((cp) => Promise.resolve(cp)),
        softRemove: jest.fn(),
      };
      mockHistoryRepo = {
        create: jest.fn().mockImplementation((h) => h),
        save: jest.fn().mockImplementation((h) => Promise.resolve(h)),
      };

      mockManager = {
        getRepository: jest
          .fn()
          .mockImplementation(
            <Entity extends ObjectLiteral>(
              entityClass: EntityTarget<Entity>,
            ): Repository<Entity> => {
              if (entityClass === Person) return mockPersonRepo as unknown as Repository<Entity>;
              if (entityClass === Contract)
                return mockContractRepo as unknown as Repository<Entity>;
              if (entityClass === ContractPerson)
                return mockCpRepo as unknown as Repository<Entity>;
              if (entityClass === AffiliationHistory)
                return mockHistoryRepo as unknown as Repository<Entity>;
              return null as unknown as Repository<Entity>;
            },
          ),
      };

      jest
        .spyOn(repository.manager, 'transaction')
        .mockImplementation(
          (
            isolationLevelOrRunInTransaction: unknown,
            runInTransaction?: (entityManager: EntityManager) => Promise<unknown>,
          ) => {
            const cb =
              typeof isolationLevelOrRunInTransaction === 'function'
                ? (isolationLevelOrRunInTransaction as (
                    entityManager: EntityManager,
                  ) => Promise<unknown>)
                : runInTransaction!;
            return cb(mockManager as EntityManager) as Promise<unknown>; // return as Promise<unknown> since transaction is typed dynamically
          },
        );
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);
    });

    it('should successfully create a contract with a new person', async () => {
      const dto: CreateContractFullDto = {
        affiliationDate: '2023-01-01',
        code: 'NEW-123',
        affiliates: [
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '12345678',
            name: 'Juan Perez',
            role: PersonRole.TITULAR,
            isBillingOwner: true,
          },
        ],
      };

      const result = await service.createFull(dto);

      expect(repository.findOne).toHaveBeenCalledWith({ where: { code: 'NEW-123' } });
      expect(mockContractRepo.create).toHaveBeenCalled();
      expect(mockContractRepo.save).toHaveBeenCalled();
      expect(mockPersonRepo.findOne).toHaveBeenCalledWith({
        where: { identityCard: '12345678', typeIdentityCard: TypeIdentityCard.V },
        lock: { mode: 'pessimistic_write' },
      });
      expect(mockPersonRepo.save).toHaveBeenCalled();
      expect(mockCpRepo.save).toHaveBeenCalled();
      expect(result).toEqual(mockContract);
    });

    it('should throw BadRequestException if contract code already exists', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockContract);

      const dto: CreateContractFullDto = {
        affiliationDate: '2023-01-01',
        code: 'DUPLICATE',
        affiliates: [],
      };

      await expect(service.createFull(dto)).rejects.toThrow(
        'El código de contrato "DUPLICATE" ya está registrado.',
      );
    });

    it('should throw BadRequestException if there is more than one titular', async () => {
      const dto: CreateContractFullDto = {
        affiliationDate: '2023-01-01',
        code: 'NEW-123',
        affiliates: [
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '1',
            name: 'Juan',
            role: PersonRole.TITULAR,
          },
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '2',
            name: 'Pedro',
            role: PersonRole.TITULAR,
          },
        ],
      };

      await expect(service.createFull(dto)).rejects.toThrow(
        'Solo puede haber un TITULAR por contrato.',
      );
    });

    it('should throw BadRequestException if affiliate is already an active beneficiary elsewhere', async () => {
      const existingPerson = {
        id: 'person-1',
        name: 'Juan',
        identityCard: '123',
        typeIdentityCard: TypeIdentityCard.V,
      } as Person;
      mockPersonRepo.findOne.mockResolvedValue(existingPerson);
      mockCpRepo.find.mockResolvedValue([
        { id: 'cp-active-relation', contract: { code: 'ACTIVE-CODE' } },
      ]);

      const dto: CreateContractFullDto = {
        affiliationDate: '2023-01-01',
        code: 'NEW-123',
        affiliates: [
          {
            typeIdentityCard: TypeIdentityCard.V,
            identityCard: '123',
            name: 'Juan',
            role: PersonRole.AFILIADO,
            planId: 'plan-1',
          },
        ],
      };

      jest
        .spyOn(service['plansService'], 'findOne')
        .mockResolvedValue({ id: 'plan-1', amount: 10 } as Plan);

      await expect(service.createFull(dto)).rejects.toThrow(
        'El afiliado Juan (V-123) ya es beneficiario activo en el contrato: ACTIVE-CODE. Debe ser desafiliado primero antes de asignarlo a otro contrato.',
      );
    });
  });

  describe('inactivate', () => {
    let mockManager: Partial<EntityManager>;
    let mockContractRepo: {
      findOne: jest.Mock;
      save: jest.Mock;
    };
    let mockCpRepo: {
      find: jest.Mock;
    };
    let mockHistoryRepo: {
      create: jest.Mock;
      save: jest.Mock;
    };

    beforeEach(() => {
      mockContractRepo = {
        findOne: jest.fn().mockResolvedValue({ ...mockContract, status: ContractStatus.ACTIVE }),
        save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
      };
      mockCpRepo = {
        find: jest
          .fn()
          .mockResolvedValue([{ person: { id: 'p-1', plan: { id: 'plan-1', amount: 50 } } }]),
      };
      mockHistoryRepo = {
        create: jest.fn().mockImplementation((h) => h),
        save: jest.fn().mockImplementation((h) => Promise.resolve(h)),
      };

      mockManager = {
        getRepository: jest
          .fn()
          .mockImplementation(
            <Entity extends ObjectLiteral>(
              entityClass: EntityTarget<Entity>,
            ): Repository<Entity> => {
              if (entityClass === Contract)
                return mockContractRepo as unknown as Repository<Entity>;
              if (entityClass === ContractPerson)
                return mockCpRepo as unknown as Repository<Entity>;
              if (entityClass === AffiliationHistory)
                return mockHistoryRepo as unknown as Repository<Entity>;
              return null as unknown as Repository<Entity>;
            },
          ),
      };

      jest
        .spyOn(repository.manager, 'transaction')
        .mockImplementation(
          (
            isolationLevelOrRunInTransaction: unknown,
            runInTransaction?: (entityManager: EntityManager) => Promise<unknown>,
          ) => {
            const cb =
              typeof isolationLevelOrRunInTransaction === 'function'
                ? (isolationLevelOrRunInTransaction as (
                    entityManager: EntityManager,
                  ) => Promise<unknown>)
                : runInTransaction!;
            return cb(mockManager as EntityManager) as Promise<unknown>; // return as Promise<unknown> instead of any
          },
        );
    });

    it('should successfully inactivate an active contract and truncate the history reason to 255 chars', async () => {
      const activeContract = { ...mockContract, status: ContractStatus.ACTIVE };
      jest.spyOn(service, 'findOne').mockResolvedValue(activeContract);
      mockContractRepo.findOne.mockResolvedValue(activeContract);

      const dto: InactivateContractDto = {
        reason: 'A'.repeat(300), // 300 characters reason
      };

      const result = await service.inactivate('1', dto);

      expect(result.status).toBe(ContractStatus.INACTIVE);
      expect(result.inactivationReason).toBe(dto.reason);
      expect(mockContractRepo.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(mockCpRepo.find).toHaveBeenCalledWith({
        where: { contract: { id: '1' }, role: PersonRole.AFILIADO },
        relations: ['person', 'person.plan'],
      });
      expect(mockHistoryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'A'.repeat(255), // Check that it was truncated to 255
          action: 'DESAFILIACION',
        }),
      );
    });

    it('should throw BadRequestException if contract is already inactive before transaction', async () => {
      const inactiveContract = { ...mockContract, status: ContractStatus.INACTIVE };
      jest.spyOn(service, 'findOne').mockResolvedValue(inactiveContract);

      const dto: InactivateContractDto = { reason: 'reason' };

      await expect(service.inactivate('1', dto)).rejects.toThrow(
        'El contrato ya se encuentra inactivo.',
      );
    });

    it('should throw BadRequestException if contract becomes inactive under concurrency (lock returns inactive)', async () => {
      const activeContract = { ...mockContract, status: ContractStatus.ACTIVE };
      const inactiveContract = { ...mockContract, status: ContractStatus.INACTIVE };

      jest.spyOn(service, 'findOne').mockResolvedValue(activeContract);
      mockContractRepo.findOne.mockResolvedValue(inactiveContract); // Locks and discovers it was inactivated by another process

      const dto: InactivateContractDto = { reason: 'reason' };

      await expect(service.inactivate('1', dto)).rejects.toThrow(
        'El contrato ya se encuentra inactivo.',
      );
    });
  });
});
