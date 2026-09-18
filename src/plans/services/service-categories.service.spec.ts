import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EntityAlreadyExistsException,
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions';
import { CreateServiceCategoryDto } from '../dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from '../dto/update-service-category.dto';
import { MedicalService } from '../entities/medical-service.entity';
import { ServiceCategory } from '../entities/service-category.entity';
import { ServiceCategoriesService } from './service-categories.service';

describe('ServiceCategoriesService', () => {
  let service: ServiceCategoriesService;
  let categoryRepo: jest.Mocked<Repository<ServiceCategory>>;
  let medicalServiceRepo: jest.Mocked<Repository<MedicalService>>;

  const mockCategory: ServiceCategory = {
    id: 'cat-uuid-1',
    code: 'CAT-01',
    name: 'Laboratorio y Diagnóstico',
    description: 'Análisis clínicos y pruebas de laboratorio',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceCategoriesService,
        {
          provide: getRepositoryToken(ServiceCategory),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(MedicalService),
          useValue: {
            count: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ServiceCategoriesService>(ServiceCategoriesService);
    categoryRepo = module.get(getRepositoryToken(ServiceCategory));
    medicalServiceRepo = module.get(getRepositoryToken(MedicalService));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create and save a new category', async () => {
      const dto: CreateServiceCategoryDto = {
        code: 'CAT-01',
        name: 'Laboratorio y Diagnóstico',
        description: 'Análisis clínicos',
        isActive: true,
      };

      categoryRepo.findOne.mockResolvedValue(null);
      categoryRepo.create.mockReturnValue(mockCategory);
      categoryRepo.save.mockResolvedValue(mockCategory);

      const result = await service.create(dto);

      expect(categoryRepo.findOne).toHaveBeenCalledWith({
        where: { code: dto.code },
      });
      expect(categoryRepo.create).toHaveBeenCalledWith(dto);
      expect(categoryRepo.save).toHaveBeenCalledWith(mockCategory);
      expect(result).toEqual(mockCategory);
    });

    it('should throw EntityAlreadyExistsException if code is already active', async () => {
      const dto: CreateServiceCategoryDto = {
        code: 'CAT-01',
        name: 'Laboratorio',
      };

      categoryRepo.findOne.mockResolvedValue(mockCategory);

      await expect(service.create(dto)).rejects.toThrow(EntityAlreadyExistsException);
      expect(categoryRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return all active categories ordered by name', async () => {
      categoryRepo.find.mockResolvedValue([mockCategory]);

      const result = await service.findAll();

      expect(categoryRepo.find).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
      expect(result).toEqual([mockCategory]);
    });
  });

  describe('findOne', () => {
    it('should return category when found', async () => {
      categoryRepo.findOne.mockResolvedValue(mockCategory);

      const result = await service.findOne('cat-uuid-1');

      expect(categoryRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'cat-uuid-1' },
      });
      expect(result).toEqual(mockCategory);
    });

    it('should throw EntityNotFoundException if category is not found', async () => {
      categoryRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('ghost-id')).rejects.toThrow(EntityNotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return the category', async () => {
      const dto: UpdateServiceCategoryDto = {
        name: 'Laboratorio Clínico Actualizado',
      };
      const updatedCategory = { ...mockCategory, ...dto };

      categoryRepo.findOne.mockResolvedValue(mockCategory);
      categoryRepo.save.mockResolvedValue(updatedCategory as ServiceCategory);

      const result = await service.update('cat-uuid-1', dto);

      expect(categoryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Laboratorio Clínico Actualizado' }),
      );
      expect(result.name).toBe('Laboratorio Clínico Actualizado');
    });

    it('should allow keeping the exact same code', async () => {
      const dto: UpdateServiceCategoryDto = {
        code: 'CAT-01',
        name: 'Same Code',
      };

      categoryRepo.findOne.mockResolvedValue(mockCategory);
      categoryRepo.save.mockResolvedValue({ ...mockCategory, name: 'Same Code' });

      const result = await service.update('cat-uuid-1', dto);

      expect(result.name).toBe('Same Code');
    });

    it('should throw EntityAlreadyExistsException when updating to a code already used by another category', async () => {
      const dto: UpdateServiceCategoryDto = { code: 'CAT-02' };
      const anotherCategory: ServiceCategory = {
        ...mockCategory,
        id: 'cat-uuid-2',
        code: 'CAT-02',
      };

      categoryRepo.findOne
        .mockResolvedValueOnce(mockCategory) // findOne for target category
        .mockResolvedValueOnce(anotherCategory); // findOne for checking new code collision

      await expect(service.update('cat-uuid-1', dto)).rejects.toThrow(EntityAlreadyExistsException);
      expect(categoryRepo.save).not.toHaveBeenCalled();
    });

    it('should throw EntityNotFoundException if category to update does not exist', async () => {
      categoryRepo.findOne.mockResolvedValue(null);

      await expect(service.update('non-existent', { name: 'New' })).rejects.toThrow(
        EntityNotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should soft delete category if no active medical services are attached', async () => {
      categoryRepo.findOne.mockResolvedValue(mockCategory);
      medicalServiceRepo.count.mockResolvedValue(0);
      categoryRepo.softRemove.mockResolvedValue({
        ...mockCategory,
        deletedAt: new Date(),
      });

      const result = await service.remove('cat-uuid-1');

      expect(medicalServiceRepo.count).toHaveBeenCalledWith({
        where: { categoryId: 'cat-uuid-1' },
      });
      expect(categoryRepo.softRemove).toHaveBeenCalledWith(mockCategory);
      expect(result.deletedAt).toBeDefined();
    });

    it('should throw InvalidDomainOperationException if active medical services exist', async () => {
      categoryRepo.findOne.mockResolvedValue(mockCategory);
      medicalServiceRepo.count.mockResolvedValue(3);

      await expect(service.remove('cat-uuid-1')).rejects.toThrow(InvalidDomainOperationException);
      expect(categoryRepo.softRemove).not.toHaveBeenCalled();
    });

    it('should throw EntityNotFoundException if category to remove does not exist', async () => {
      categoryRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('ghost-id')).rejects.toThrow(EntityNotFoundException);
    });
  });
});
