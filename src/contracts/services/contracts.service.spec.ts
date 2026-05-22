import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { Plan } from '../../plans/entities/plan.entity';
import { CreateContractDto } from '../dto/create-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ContractPerson } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { ContractsService } from './contracts.service';

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
  };

  const CONTRACTS_REPOSITORY_TOKEN = getRepositoryToken(Contract);
  const CONTRACT_PERSONS_REPOSITORY_TOKEN = getRepositoryToken(ContractPerson);

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
          provide: CONTRACTS_REPOSITORY_TOKEN,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
            findAndCount: jest.fn(),
            update: jest.fn(),
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
    it('should return an array of contracts', async () => {
      jest.spyOn(repository, 'findAndCount').mockResolvedValue([[mockContract], 1]);

      const result = await service.findAll({});

      expect(repository.findAndCount).toHaveBeenCalledWith({
        relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
        order: { code: 'ASC' },
        skip: 0,
        take: 10,
        where: {
          code: undefined,
        },
      });
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
