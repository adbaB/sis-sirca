import { Test, TestingModule } from '@nestjs/testing';
import { CreateServiceCategoryDto } from '../dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from '../dto/update-service-category.dto';
import { ServiceCategory } from '../entities/service-category.entity';
import { ServiceCategoriesService } from '../services/service-categories.service';
import { ServiceCategoriesController } from './service-categories.controller';

describe('ServiceCategoriesController', () => {
  let controller: ServiceCategoriesController;
  let service: ServiceCategoriesService;

  const mockCategory: ServiceCategory = {
    id: 'cat-uuid-1',
    code: 'CAT-01',
    name: 'Laboratorio',
    description: 'Análisis clínicos',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceCategoriesController],
      providers: [
        {
          provide: ServiceCategoriesService,
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

    controller = module.get<ServiceCategoriesController>(ServiceCategoriesController);
    service = module.get<ServiceCategoriesService>(ServiceCategoriesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a service category', async () => {
      const dto: CreateServiceCategoryDto = {
        code: 'CAT-01',
        name: 'Laboratorio',
        description: 'Análisis clínicos',
        isActive: true,
      };

      jest.spyOn(service, 'create').mockResolvedValue(mockCategory);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockCategory);
    });
  });

  describe('findAll', () => {
    it('should return an array of service categories', async () => {
      jest.spyOn(service, 'findAll').mockResolvedValue([mockCategory]);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual([mockCategory]);
    });
  });

  describe('findOne', () => {
    it('should return a single service category', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockCategory);

      const result = await controller.findOne('cat-uuid-1');

      expect(service.findOne).toHaveBeenCalledWith('cat-uuid-1');
      expect(result).toEqual(mockCategory);
    });
  });

  describe('update', () => {
    it('should update a service category', async () => {
      const dto: UpdateServiceCategoryDto = { name: 'Laboratorio Actualizado' };
      const updated = { ...mockCategory, ...dto } as ServiceCategory;

      jest.spyOn(service, 'update').mockResolvedValue(updated);

      const result = await controller.update('cat-uuid-1', dto);

      expect(service.update).toHaveBeenCalledWith('cat-uuid-1', dto);
      expect(result).toEqual(updated);
    });
  });

  describe('remove', () => {
    it('should remove a service category', async () => {
      jest.spyOn(service, 'remove').mockResolvedValue(mockCategory);

      const result = await controller.remove('cat-uuid-1');

      expect(service.remove).toHaveBeenCalledWith('cat-uuid-1');
      expect(result).toEqual(mockCategory);
    });
  });
});
