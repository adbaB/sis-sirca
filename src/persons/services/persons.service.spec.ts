import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Contract } from '../../contracts/entities/contract.entity';
import { ContractsService } from '../../contracts/services/contracts.service';
import { Plan } from '../../plans/entities/plan.entity';
import { PlansService } from '../../plans/services/plans.service';
import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { Person, PersonStatus, TypeIdentityCard } from '../entities/person.entity';
import { PersonsService } from './persons.service';
import { ContractPerson, PersonRole } from '../../contracts/entities/contract-person.entity';

describe('PersonsService', () => {
  let service: PersonsService;
  let repository: Repository<Person>;
  let cpRepository: Repository<ContractPerson>;
  let plansService: PlansService;
  let contractsService: ContractsService;

  const mockPlan: Plan = { id: 'plan-1', name: 'Basic', amount: 10 } as Plan;
  const mockContract: Contract = {
    id: 'contract-1',
    affiliationDate: new Date('2023-01-01'),
    monthlyAmount: 0,
  } as Contract;

  const mockContractPerson: ContractPerson = {
    id: 'cp-1',
    contract: mockContract,
    person: {} as Person,
    role: PersonRole.AFILIADO,
  } as ContractPerson;

  const mockPerson: Person = {
    id: '1',
    typeIdentityCard: TypeIdentityCard.V,
    identityCard: '123456',
    name: 'John Doe',
    birthDate: new Date('1990-01-01'),
    gender: true,
    plan: mockPlan,
    contractPersons: [mockContractPerson],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    status: PersonStatus.ACTIVE,
  };

  const PERSONS_REPOSITORY_TOKEN = getRepositoryToken(Person);
  const CP_REPOSITORY_TOKEN = getRepositoryToken(ContractPerson);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonsService,
        {
          provide: PERSONS_REPOSITORY_TOKEN,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: CP_REPOSITORY_TOKEN,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: PlansService,
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: ContractsService,
          useValue: {
            findOne: jest.fn(),
            recalculateMonthlyAmount: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PersonsService>(PersonsService);
    repository = module.get<Repository<Person>>(PERSONS_REPOSITORY_TOKEN);
    cpRepository = module.get<Repository<ContractPerson>>(CP_REPOSITORY_TOKEN);
    plansService = module.get<PlansService>(PlansService);
    contractsService = module.get<ContractsService>(ContractsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a person', async () => {
      const createPersonDto: CreatePersonDto = {
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '123456',
        name: 'John Doe',
        birthDate: '1990-01-01',
        gender: true,
        planId: 'plan-1',
        contractId: 'contract-1',
        role: PersonRole.AFILIADO,
      };

      jest.spyOn(plansService, 'findOne').mockResolvedValue(mockPlan);
      jest.spyOn(contractsService, 'findOne').mockResolvedValue(mockContract);
      jest.spyOn(repository, 'create').mockReturnValue(mockPerson);
      jest.spyOn(repository, 'save').mockResolvedValue(mockPerson);
      jest.spyOn(cpRepository, 'create').mockReturnValue(mockContractPerson);

      const result = await service.create(createPersonDto);

      expect(plansService.findOne).toHaveBeenCalledWith('plan-1');
      expect(contractsService.findOne).toHaveBeenCalledWith('contract-1');
      expect(repository.create).toHaveBeenCalledWith({
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '123456',
        name: 'John Doe',
        birthDate: '1990-01-01',
        gender: true,
        plan: mockPlan,
      });
      expect(repository.save).toHaveBeenCalledWith(mockPerson);
      expect(cpRepository.create).toHaveBeenCalledWith({
        contract: mockContract,
        person: mockPerson,
        role: PersonRole.AFILIADO,
      });
      expect(cpRepository.save).toHaveBeenCalledWith(mockContractPerson);
      expect(contractsService.recalculateMonthlyAmount).toHaveBeenCalledWith('contract-1');
      expect(result).toEqual(mockPerson);
    });

    it('should throw NotFoundException if plan does not exist', async () => {
      const createPersonDto: CreatePersonDto = {
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: 'invalid-id',
        name: 'John Doe',
        birthDate: '1990-01-01',
        gender: true,
        planId: 'invalid-plan',
        contractId: 'contract-1',
      };

      jest.spyOn(plansService, 'findOne').mockResolvedValue(null);

      await expect(service.create(createPersonDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return an array of persons', async () => {
      jest.spyOn(repository, 'find').mockResolvedValue([mockPerson]);

      const result = await service.findAll();

      expect(repository.find).toHaveBeenCalledWith({ relations: ['plan', 'contractPersons', 'contractPersons.contract'] });
      expect(result).toEqual([mockPerson]);
    });
  });

  describe('findOne', () => {
    it('should return a person if it exists', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockPerson);

      const result = await service.findOne('1');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        relations: ['plan', 'contractPersons', 'contractPersons.contract'],
      });
      expect(result).toEqual(mockPerson);
    });

    it('should throw NotFoundException if person does not exist', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await expect(service.findOne('2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return a person and recalculate contract amounts', async () => {
      const updatePersonDto: UpdatePersonDto = { name: 'Jane Doe', planId: 'plan-1', contractId: 'contract-1', role: PersonRole.AFILIADO };
      const updatedPerson = { ...mockPerson, name: 'Jane Doe' };

      jest.spyOn(service, 'findOne').mockResolvedValue(mockPerson);
      jest.spyOn(plansService, 'findOne').mockResolvedValue(mockPlan);
      jest.spyOn(contractsService, 'findOne').mockResolvedValue(mockContract);
      jest.spyOn(repository, 'save').mockResolvedValue(updatedPerson as Person);
      jest.spyOn(cpRepository, 'findOne').mockResolvedValue(mockContractPerson);
      jest.spyOn(cpRepository, 'find').mockResolvedValue([mockContractPerson]);

      const result = await service.update('1', updatePersonDto);

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(plansService.findOne).toHaveBeenCalledWith('plan-1');
      expect(repository.save).toHaveBeenCalled();

      expect(contractsService.recalculateMonthlyAmount).toHaveBeenCalledWith('contract-1');
      expect(result.name).toEqual('Jane Doe');
    });

    it('should handle removing an AFILIADO from their old contract when added to a new one', async () => {
      const updatePersonDto: UpdatePersonDto = { contractId: 'contract-2', role: PersonRole.AFILIADO };

      const newContract: Contract = { id: 'contract-2' } as Contract;
      const oldJunction: ContractPerson = { ...mockContractPerson, contract: mockContract };

      jest.spyOn(service, 'findOne').mockResolvedValue(mockPerson);
      jest.spyOn(contractsService, 'findOne').mockResolvedValue(newContract);
      jest.spyOn(repository, 'save').mockResolvedValue(mockPerson as Person);
      jest.spyOn(cpRepository, 'findOne').mockResolvedValue(null); // Not in the new contract yet
      jest.spyOn(cpRepository, 'find').mockResolvedValue([oldJunction]); // In the old contract
      jest.spyOn(cpRepository, 'remove').mockResolvedValue(oldJunction);

      await service.update('1', updatePersonDto);

      // Verify the old junction was removed
      expect(cpRepository.remove).toHaveBeenCalledWith(oldJunction);

      // Verify both the new and old contracts are recalculated
      expect(contractsService.recalculateMonthlyAmount).toHaveBeenCalledWith('contract-1');
      expect(contractsService.recalculateMonthlyAmount).toHaveBeenCalledWith('contract-2');
    });

    it('should not wipe global plan when adding a TITULAR to a new contract', async () => {
      const updatePersonDto: UpdatePersonDto = { contractId: 'contract-2', role: PersonRole.TITULAR };
      const newContract: Contract = { id: 'contract-2' } as Contract;

      jest.spyOn(service, 'findOne').mockResolvedValue(mockPerson); // Mock person has a plan
      jest.spyOn(contractsService, 'findOne').mockResolvedValue(newContract);

      // Let's assert what is saved to the Person repository
      let savedPerson: Partial<Person> = {};
      jest.spyOn(repository, 'save').mockImplementation(async (personToSave) => {
        savedPerson = personToSave as unknown as Person;
        return personToSave as Person;
      });

      await service.update('1', updatePersonDto);

      // Ensure the plan was NOT nullified.
      expect(savedPerson.plan).toEqual(mockPlan);
    });

    it('should throw NotFoundException if new plan does not exist', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockPerson);
      jest.spyOn(plansService, 'findOne').mockResolvedValue(null);

      const updatePersonDto: UpdatePersonDto = { planId: 'invalid-plan' };
      await expect(service.update('1', updatePersonDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft remove a person and recalculate contract amount', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockPerson);
      jest.spyOn(repository, 'softRemove').mockResolvedValue(mockPerson);

      await service.remove('1');

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(repository.softRemove).toHaveBeenCalledWith(mockPerson);
      expect(contractsService.recalculateMonthlyAmount).toHaveBeenCalledWith('contract-1');
    });
  });
});
