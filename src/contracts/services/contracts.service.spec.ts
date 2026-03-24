import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

import { ContractsService } from './contracts.service';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { CreateContractDto } from '../dto/create-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { Plan } from '../../plans/entities/plan.entity';

describe('ContractsService', () => {
  let service: ContractsService;
  let repository: Repository<Contract>;

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        {
          provide: CONTRACTS_REPOSITORY_TOKEN,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    repository = module.get<Repository<Contract>>(CONTRACTS_REPOSITORY_TOKEN);
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
      jest.spyOn(repository, 'find').mockResolvedValue([mockContract]);

      const result = await service.findAll();

      expect(repository.find).toHaveBeenCalledWith({
        relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
      });
      expect(result).toEqual([mockContract]);
    });
  });

  describe('findOne', () => {
    it('should return a contract if it exists', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockContract);

      const result = await service.findOne('1');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
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

      const contractWithPersons: Contract = {
        ...mockContract,
        contractPersons: [
          { role: 'AFILIADO', person: mockPerson1 },
          { role: 'AFILIADO', person: mockPerson2 },
          { role: 'TITULAR', person: mockPersonWithoutPlan }, // should not be counted even if it had a plan
        ] as unknown as import('../entities/contract-person.entity').ContractPerson[],
      };

      jest.spyOn(repository, 'findOne').mockResolvedValue(contractWithPersons);
      jest.spyOn(repository, 'save').mockResolvedValue(contractWithPersons);

      await service.recalculateMonthlyAmount('1');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: '1', contractPersons: { person: { status: PersonStatus.ACTIVE } } },
        relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
      });
      expect(contractWithPersons.monthlyAmount).toEqual(30); // 10 + 20
      expect(repository.save).toHaveBeenCalledWith(contractWithPersons);
    });

    it('should gracefully handle an invalid contract id', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await service.recalculateMonthlyAmount('invalid-id');

      expect(repository.save).not.toHaveBeenCalled();
    });
  });
});
