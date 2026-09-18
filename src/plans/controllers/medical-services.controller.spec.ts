import { Test, TestingModule } from '@nestjs/testing';
import { HealthCategory } from '../../contracts/entities/health-declaration.entity';
import { CreateMedicalServiceDto } from '../dto/create-medical-service.dto';
import { UpdateMedicalServiceDto } from '../dto/update-medical-service.dto';
import { MedicalService } from '../entities/medical-service.entity';
import { MedicalServicesService } from '../services/medical-services.service';
import { MedicalServicesController } from './medical-services.controller';

describe('MedicalServicesController', () => {
  let controller: MedicalServicesController;
  let service: MedicalServicesService;

  const mockService: MedicalService = {
    id: 'med-uuid-1',
    code: 'MED-01',
    name: 'Electrocardiograma',
    description: 'Estudio cardiológico',
    categoryId: 'cat-uuid-1',
    category: {
      id: 'cat-uuid-1',
      code: 'CAT-01',
      name: 'Cardiología',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicalServicesController],
      providers: [
        {
          provide: MedicalServicesService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            findByHealthCategories: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<MedicalServicesController>(MedicalServicesController);
    service = module.get<MedicalServicesService>(MedicalServicesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a medical service', async () => {
      const dto: CreateMedicalServiceDto = {
        code: 'MED-01',
        name: 'Electrocardiograma',
        categoryId: 'cat-uuid-1',
        linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
        isActive: true,
      };

      jest.spyOn(service, 'create').mockResolvedValue(mockService);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockService);
    });
  });

  describe('findAll', () => {
    it('should return an array of medical services', async () => {
      jest.spyOn(service, 'findAll').mockResolvedValue([mockService]);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual([mockService]);
    });
  });

  describe('findOne', () => {
    it('should return a single medical service', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockService);

      const result = await controller.findOne('med-uuid-1');

      expect(service.findOne).toHaveBeenCalledWith('med-uuid-1');
      expect(result).toEqual(mockService);
    });
  });

  describe('update', () => {
    it('should update a medical service', async () => {
      const dto: UpdateMedicalServiceDto = { name: 'Electrocardiograma 12 Derivaciones' };
      const updated = { ...mockService, ...dto } as MedicalService;

      jest.spyOn(service, 'update').mockResolvedValue(updated);

      const result = await controller.update('med-uuid-1', dto);

      expect(service.update).toHaveBeenCalledWith('med-uuid-1', dto);
      expect(result).toEqual(updated);
    });
  });

  describe('remove', () => {
    it('should remove a medical service', async () => {
      jest.spyOn(service, 'remove').mockResolvedValue(mockService);

      const result = await controller.remove('med-uuid-1');

      expect(service.remove).toHaveBeenCalledWith('med-uuid-1');
      expect(result).toEqual(mockService);
    });
  });
});
