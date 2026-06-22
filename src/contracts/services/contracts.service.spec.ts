import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { Plan } from '../../plans/entities/plan.entity';
import { CreateContractDto } from '../dto/create-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ContractPerson } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractsService } from './contracts.service';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
import { BillingService } from '../../billing/services/billing.service';
import { PlansService } from '../../plans/services/plans.service';

describe('ContractsService', () => {
  let service: ContractsService;
  let repository: Repository<Contract>;
  let contractPersonsRepository: Repository<ContractPerson>;

  const mockContract: Contract = {
    id: '1',
    code: '1',
    affiliationDate: new Date('2023-01-01'),
    monthlyAmount: 0,
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

      jest.spyOn(repository, 'create').mockReturnValue(mockContract);
      jest.spyOn(repository, 'save').mockResolvedValue(mockContract);

      const result = await service.create(createContractDto);

      expect(repository.create).toHaveBeenCalledWith(createContractDto);
      expect(repository.save).toHaveBeenCalledWith(mockContract);
      expect(result).toEqual(mockContract);
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
});
