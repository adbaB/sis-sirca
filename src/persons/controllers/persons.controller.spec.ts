import { Test, TestingModule } from '@nestjs/testing';
import { CreatePersonDto } from '../dto/create-person.dto';
import { Person, TypeIdentityCard } from '../entities/person.entity';
import { PersonBenefitsResponseDto } from '../dto/person-benefits-response.dto';
import { PersonBenefitsService } from '../services/person-benefits.service';
import { PersonsService } from '../services/persons.service';
import { PersonsController } from './persons.controller';

describe('PersonsController', () => {
  let controller: PersonsController;
  let service: PersonsService;
  let benefitsService: PersonBenefitsService;

  const mockPerson = {
    id: '1',
    identityCard: '123456',
    name: 'John Doe',
    birthDate: new Date('1990-01-01'),
    gender: true,
    plan: null,
    contractPersons: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as unknown as Person;

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
            findByIdentityCard: jest.fn(),
          },
        },
        {
          provide: PersonBenefitsService,
          useValue: {
            getPersonBenefits: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PersonsController>(PersonsController);
    service = module.get<PersonsService>(PersonsService);
    benefitsService = module.get<PersonBenefitsService>(PersonBenefitsService);
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

  describe('remove', () => {
    it('should remove a person', async () => {
      jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      await controller.remove('1');

      expect(service.remove).toHaveBeenCalledWith('1');
    });
  });

  describe('getPersonBenefits', () => {
    it('should delegate to personBenefitsService.getPersonBenefits', async () => {
      const mockBenefits = {
        person: {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          identityCard: '123456',
          typeIdentityCard: 'V',
        },
        contract: {
          id: 'c-1',
          code: 'CTR-1',
          status: 'ACTIVE',
          affiliationDate: new Date(),
        },
        plan: {
          id: 'p-1',
          code: 'PLN-1',
          name: 'Plan Basico',
        },
        affiliationDaysElapsed: 10,
        services: [],
      };

      jest
        .spyOn(benefitsService, 'getPersonBenefits')
        .mockResolvedValue(mockBenefits as unknown as PersonBenefitsResponseDto);

      const result = await controller.getPersonBenefits('1');

      expect(benefitsService.getPersonBenefits).toHaveBeenCalledWith('1');
      expect(result).toEqual(mockBenefits);
    });
  });
});
