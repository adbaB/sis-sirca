import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  EntityAlreadyExistsException,
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions';
import { HealthCategory } from '../../contracts/entities/health-declaration.entity';
import { CreateMedicalServiceDto } from '../dto/create-medical-service.dto';
import { UpdateMedicalServiceDto } from '../dto/update-medical-service.dto';
import { MedicalService } from '../entities/medical-service.entity';
import { PlanService } from '../entities/plan-service.entity';
import { ServiceCategory } from '../entities/service-category.entity';
import { MedicalServicesService } from './medical-services.service';

describe('MedicalServicesService', () => {
  let service: MedicalServicesService;
  let medicalServiceRepo: jest.Mocked<Repository<MedicalService>>;
  let categoryRepo: jest.Mocked<Repository<ServiceCategory>>;
  let planServiceRepo: jest.Mocked<Repository<PlanService>>;

  const mockCategory: ServiceCategory = {
    id: 'cat-uuid-1',
    code: 'CAT-01',
    name: 'Cardiología',
    description: 'Especialidad médica',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockMedicalService: MedicalService = {
    id: 'med-uuid-1',
    code: 'MED-01',
    name: 'Electrocardiograma de Reposo',
    description: 'Examen de actividad cardiaca',
    categoryId: 'cat-uuid-1',
    category: mockCategory,
    linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  let mockQueryBuilder: Partial<SelectQueryBuilder<MedicalService>>;

  beforeEach(async () => {
    mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([mockMedicalService]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicalServicesService,
        {
          provide: getRepositoryToken(MedicalService),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          },
        },
        {
          provide: getRepositoryToken(ServiceCategory),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlanService),
          useValue: {
            count: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MedicalServicesService>(MedicalServicesService);
    medicalServiceRepo = module.get(getRepositoryToken(MedicalService));
    categoryRepo = module.get(getRepositoryToken(ServiceCategory));
    planServiceRepo = module.get(getRepositoryToken(PlanService));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a new medical service', async () => {
      const dto: CreateMedicalServiceDto = {
        code: 'MED-01',
        name: 'Electrocardiograma de Reposo',
        description: 'Examen de actividad cardiaca',
        categoryId: 'cat-uuid-1',
        linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
        isActive: true,
      };

      categoryRepo.findOne.mockResolvedValue(mockCategory);
      medicalServiceRepo.findOne.mockResolvedValue(null);
      medicalServiceRepo.create.mockReturnValue(mockMedicalService);
      medicalServiceRepo.save.mockResolvedValue(mockMedicalService);

      const result = await service.create(dto);

      expect(categoryRepo.findOne).toHaveBeenCalledWith({
        where: { id: dto.categoryId },
      });
      expect(medicalServiceRepo.findOne).toHaveBeenCalledWith({
        where: { code: dto.code },
      });
      expect(medicalServiceRepo.create).toHaveBeenCalledWith({
        ...dto,
        linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
      });
      expect(medicalServiceRepo.save).toHaveBeenCalledWith(mockMedicalService);
      expect(result).toEqual(mockMedicalService);
    });

    it('should throw EntityNotFoundException if category does not exist', async () => {
      const dto: CreateMedicalServiceDto = {
        code: 'MED-01',
        name: 'Electrocardiograma',
        categoryId: 'ghost-category',
      };

      categoryRepo.findOne.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(EntityNotFoundException);
      expect(medicalServiceRepo.save).not.toHaveBeenCalled();
    });

    it('should throw EntityAlreadyExistsException if code is duplicate', async () => {
      const dto: CreateMedicalServiceDto = {
        code: 'MED-01',
        name: 'Electrocardiograma',
        categoryId: 'cat-uuid-1',
      };

      categoryRepo.findOne.mockResolvedValue(mockCategory);
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);

      await expect(service.create(dto)).rejects.toThrow(EntityAlreadyExistsException);
      expect(medicalServiceRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return active medical services with category relation', async () => {
      medicalServiceRepo.find.mockResolvedValue([mockMedicalService]);

      const result = await service.findAll();

      expect(medicalServiceRepo.find).toHaveBeenCalledWith({
        relations: { category: true },
        order: { name: 'ASC' },
      });
      expect(result).toEqual([mockMedicalService]);
    });
  });

  describe('findOne', () => {
    it('should return service when found', async () => {
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);

      const result = await service.findOne('med-uuid-1');

      expect(medicalServiceRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'med-uuid-1' },
        relations: { category: true },
      });
      expect(result).toEqual(mockMedicalService);
    });

    it('should throw EntityNotFoundException if service does not exist', async () => {
      medicalServiceRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('ghost-id')).rejects.toThrow(EntityNotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return the medical service', async () => {
      const dto: UpdateMedicalServiceDto = {
        name: 'Electrocardiograma con Tira de Ritmo',
      };
      const updated = { ...mockMedicalService, ...dto };

      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);
      medicalServiceRepo.save.mockResolvedValue(updated as MedicalService);

      const result = await service.update('med-uuid-1', dto);

      expect(medicalServiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Electrocardiograma con Tira de Ritmo' }),
      );
      expect(result.name).toBe('Electrocardiograma con Tira de Ritmo');
    });

    it('should validate category exists when categoryId is updated', async () => {
      const dto: UpdateMedicalServiceDto = { categoryId: 'new-cat-uuid' };

      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);
      categoryRepo.findOne.mockResolvedValue(null);

      await expect(service.update('med-uuid-1', dto)).rejects.toThrow(EntityNotFoundException);
    });

    it('should validate code uniqueness when code is updated', async () => {
      const dto: UpdateMedicalServiceDto = { code: 'MED-DUPLICATE' };
      const anotherService = { ...mockMedicalService, id: 'med-uuid-2' };

      medicalServiceRepo.findOne
        .mockResolvedValueOnce(mockMedicalService) // target
        .mockResolvedValueOnce(anotherService as MedicalService); // collision check

      await expect(service.update('med-uuid-1', dto)).rejects.toThrow(EntityAlreadyExistsException);
    });
  });

  describe('remove', () => {
    it('should soft delete service if no active plans are attached', async () => {
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);
      planServiceRepo.count.mockResolvedValue(0);
      medicalServiceRepo.softRemove.mockResolvedValue({
        ...mockMedicalService,
        deletedAt: new Date(),
      });

      const result = await service.remove('med-uuid-1');

      expect(planServiceRepo.count).toHaveBeenCalledWith({
        where: { medicalServiceId: 'med-uuid-1' },
      });
      expect(medicalServiceRepo.softRemove).toHaveBeenCalledWith(mockMedicalService);
      expect(result.deletedAt).toBeDefined();
    });

    it('should throw InvalidDomainOperationException if attached to active plans', async () => {
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);
      planServiceRepo.count.mockResolvedValue(2);

      await expect(service.remove('med-uuid-1')).rejects.toThrow(InvalidDomainOperationException);
      expect(medicalServiceRepo.softRemove).not.toHaveBeenCalled();
    });
  });

  describe('findByHealthCategories', () => {
    it('should return empty array if categories parameter is empty or undefined', async () => {
      const resEmpty = await service.findByHealthCategories([]);
      expect(resEmpty).toEqual([]);

      const resNull = await service.findByHealthCategories(null as unknown as HealthCategory[]);
      expect(resNull).toEqual([]);
    });

    it('should query services matching categories using QueryBuilder array overlap', async () => {
      const categories = [HealthCategory.CARDIOVASCULAR, HealthCategory.ENDOCRINA];

      const result = await service.findByHealthCategories(categories);

      expect(medicalServiceRepo.createQueryBuilder).toHaveBeenCalledWith('ms');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('ms.category', 'category');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ms.is_active = :isActive', {
        isActive: true,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ms.linked_health_categories && ARRAY[:...categories]::text[]',
        { categories },
      );
      expect(result).toEqual([mockMedicalService]);
    });
  });
});
