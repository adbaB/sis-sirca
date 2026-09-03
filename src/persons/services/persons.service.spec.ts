import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { BulkUpdatePersonsDto } from '../dto/bulk-update-persons.dto';
import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { Person, PersonStatus, TypeIdentityCard } from '../entities/person.entity';
import { PersonsService } from './persons.service';

interface MockManager {
  getRepository: jest.Mock;
}

interface MockQueryRunner {
  isTransactionActive: boolean;
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  manager: MockManager;
}

interface MockDataSource {
  createQueryRunner: jest.Mock;
}

describe('PersonsService', () => {
  let service: PersonsService;
  let repository: jest.Mocked<Repository<Person>>;
  let mockManager: MockManager;
  let mockQr: MockQueryRunner;
  let mockDataSource: MockDataSource;

  const mockPerson: Person = {
    id: '1',
    typeIdentityCard: TypeIdentityCard.V,
    identityCard: '123456',
    name: 'John Doe',
    birthDate: new Date('1990-01-01'),
    gender: true,
    plan: null,
    contractPersons: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    status: PersonStatus.ACTIVE,
  };

  const PERSONS_REPOSITORY_TOKEN = getRepositoryToken(Person);

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

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQr),
    };

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
            merge: jest.fn().mockImplementation((entity, data) => Object.assign(entity, data)),
          },
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<PersonsService>(PersonsService);
    repository = module.get(PERSONS_REPOSITORY_TOKEN);
    mockManager.getRepository.mockReturnValue(repository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a new person if not existing', async () => {
      const createPersonDto: CreatePersonDto = {
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '123456',
        name: 'John Doe',
      };

      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(mockPerson);
      repository.save.mockResolvedValue(mockPerson);

      const result = await service.create(createPersonDto);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { identityCard: '123456', typeIdentityCard: TypeIdentityCard.V },
      });
      expect(repository.create).toHaveBeenCalledWith({
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '123456',
        name: 'John Doe',
      });
      expect(repository.save).toHaveBeenCalledWith(mockPerson);
      expect(result).toEqual(mockPerson);
    });

    it('should return existing person if already found by identityCard', async () => {
      const createPersonDto: CreatePersonDto = {
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '123456',
        name: 'John Doe',
      };

      repository.findOne.mockResolvedValue(mockPerson);

      const result = await service.create(createPersonDto);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { identityCard: '123456', typeIdentityCard: TypeIdentityCard.V },
      });
      expect(repository.save).not.toHaveBeenCalled();
      expect(result).toEqual(mockPerson);
    });

    it('should parse and normalize birthDate when provided', async () => {
      const createPersonDto: CreatePersonDto = {
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '123456',
        name: 'John Doe',
        birthDate: '1990-01-01',
      };

      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(mockPerson);
      repository.save.mockResolvedValue(mockPerson);

      await service.create(createPersonDto);

      expect(repository.create).toHaveBeenCalled();
      const createdArg = repository.create.mock.calls[0][0];
      expect(createdArg.birthDate).toBeInstanceOf(Date);
    });
  });

  describe('findAll', () => {
    it('should return an array of persons', async () => {
      repository.find.mockResolvedValue([mockPerson]);
      const result = await service.findAll();
      expect(result).toEqual([mockPerson]);
      expect(repository.find).toHaveBeenCalled();
    });
  });

  describe('findByIdentityCard', () => {
    it('should find person by type and number', async () => {
      repository.findOne.mockResolvedValue(mockPerson);
      const result = await service.findByIdentityCard('123456', TypeIdentityCard.V);
      expect(result).toEqual(mockPerson);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { identityCard: '123456', typeIdentityCard: TypeIdentityCard.V },
      });
    });
  });

  describe('findOne', () => {
    it('should return person if found', async () => {
      repository.findOne.mockResolvedValue(mockPerson);
      const result = await service.findOne('1');
      expect(result).toEqual(mockPerson);
    });

    it('should throw NotFoundException if not found', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.findOne('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update person fields and save', async () => {
      repository.findOne.mockResolvedValue(mockPerson);
      repository.save.mockImplementation(async (entity) => entity as Person);

      const updateDto: UpdatePersonDto = { name: 'Jane Doe' };
      const result = await service.update('1', updateDto);

      expect(result.name).toBe('Jane Doe');
      expect(repository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException if new identityCard is already taken by someone else', async () => {
      repository.findOne
        .mockResolvedValueOnce(mockPerson) // findOne('1')
        .mockResolvedValueOnce({ id: '2', identityCard: '999999' } as Person); // check uniqueness

      const updateDto: UpdatePersonDto = { identityCard: '999999' };
      await expect(service.update('1', updateDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('bulkUpdate', () => {
    it('should update each person in array using active transaction manager', async () => {
      repository.findOne.mockResolvedValue(mockPerson);
      repository.save.mockImplementation(async (entity) => entity as Person);

      const bulkDto: BulkUpdatePersonsDto = {
        persons: [{ id: '1', name: 'Updated Name' }],
      };

      await service.bulkUpdate(bulkDto);

      expect(mockQr.startTransaction).toHaveBeenCalled();
      expect(mockManager.getRepository).toHaveBeenCalledWith(Person);
      expect(repository.save).toHaveBeenCalled();
      expect(mockQr.commitTransaction).toHaveBeenCalled();
    });

    it('should rollback transaction if an update fails in the loop', async () => {
      repository.findOne
        .mockResolvedValueOnce(mockPerson) // findOne('1')
        .mockResolvedValueOnce(mockPerson) // findOne('2')
        .mockResolvedValueOnce({ id: '99', identityCard: '999999' } as Person); // duplicate lookup for '2'

      const bulkDto: BulkUpdatePersonsDto = {
        persons: [
          { id: '1', name: 'Updated First' },
          { id: '2', identityCard: '999999' },
        ],
      };

      await expect(service.bulkUpdate(bulkDto)).rejects.toThrow(BadRequestException);

      expect(mockQr.startTransaction).toHaveBeenCalled();
      expect(mockQr.rollbackTransaction).toHaveBeenCalled();
      expect(mockQr.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft remove person', async () => {
      repository.findOne.mockResolvedValue(mockPerson);
      repository.softRemove.mockResolvedValue(mockPerson);

      await service.remove('1');
      expect(repository.softRemove).toHaveBeenCalledWith(mockPerson);
    });
  });
});
