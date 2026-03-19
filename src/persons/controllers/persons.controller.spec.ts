import { Test, TestingModule } from '@nestjs/testing';
import { CreatePersonDto } from '../dto/create-person.dto';
import { UpdatePersonDto } from '../dto/update-person.dto';
import { Person, TypeIdentityCard } from '../entities/person.entity';
import { PersonsService } from '../services/persons.service';
import { PersonsController } from './persons.controller';

describe('PersonsController', () => {
  let controller: PersonsController;
  let service: PersonsService;

  const mockPerson = {
    id: '1',
    identityCard: '123456',
    name: 'John Doe',
    birthDate: new Date('1990-01-01'),
    gender: true,
    plan: null,
    contract: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as Person;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PersonsController],
      providers: [
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
      ],
    }).compile();

    controller = module.get<PersonsController>(PersonsController);
    service = module.get<PersonsService>(PersonsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a person', async () => {
      const createPersonDto: CreatePersonDto = {
        typeIdentityCard: TypeIdentityCard.V,
        identityCard: '123456',
        name: 'John Doe',
        birthDate: '1990-01-01',
        gender: true,
        planId: 'plan-1',
        contractId: 'contract-1',
      };
      jest.spyOn(service, 'create').mockResolvedValue(mockPerson);

      const result = await controller.create(createPersonDto);

      expect(service.create).toHaveBeenCalledWith(createPersonDto);
      expect(result).toEqual(mockPerson);
    });
  });

  describe('findAll', () => {
    it('should return an array of persons', async () => {
      jest.spyOn(service, 'findAll').mockResolvedValue([mockPerson]);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual([mockPerson]);
    });
  });

  describe('findOne', () => {
    it('should return a single person', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockPerson);

      const result = await controller.findOne('1');

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(result).toEqual(mockPerson);
    });
  });

  describe('update', () => {
    it('should update a person', async () => {
      const updatePersonDto: UpdatePersonDto = { name: 'Jane Doe' };
      const updatedPerson = { ...mockPerson, ...updatePersonDto } as Person;
      jest.spyOn(service, 'update').mockResolvedValue(updatedPerson);

      const result = await controller.update('1', updatePersonDto);

      expect(service.update).toHaveBeenCalledWith('1', updatePersonDto);
      expect(result).toEqual(updatedPerson);
    });
  });

  describe('remove', () => {
    it('should remove a person', async () => {
      jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      await controller.remove('1');

      expect(service.remove).toHaveBeenCalledWith('1');
    });
  });
});
