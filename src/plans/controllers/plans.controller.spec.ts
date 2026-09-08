import { Test, TestingModule } from '@nestjs/testing';
import { PlansController } from './plans.controller';
import { PlansService } from '../services/plans.service';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { Plan, PlanStatus } from '../entities/plan.entity';
import { PlanService, PlanServiceLimitType } from '../entities/plan-service.entity';
import { PlanCloningService } from '../services/plan-cloning.service';
import { PlanServicesService } from '../services/plan-services.service';

describe('PlansController', () => {
  let controller: PlansController;
  let service: PlansService;

  const mockPlan: Plan = {
    id: '1',
    name: 'Basic Plan',
    amount: 10,
    maxAge: 30,
    minAge: 0,
    commissionAmount: 0,
    coverage: 5000,
    minMonths: 2,
    status: PlanStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    persons: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlansController],
      providers: [
        {
          provide: PlansService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: PlanServicesService,
          useValue: {
            create: jest.fn(),
            createBatch: jest.fn(),
            findByPlan: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: PlanCloningService,
          useValue: {
            cloneServices: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PlansController>(PlansController);
    service = module.get<PlansService>(PlansService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a plan', async () => {
      const createPlanDto: CreatePlanDto = {
        name: 'Basic Plan',
        maxAge: 30,
        minAge: 0,
        amount: 10,
        coverage: 5000,
        minMonths: 2,
      };
      jest.spyOn(service, 'create').mockResolvedValue(mockPlan);

      const result = await controller.create(createPlanDto);

      expect(service.create).toHaveBeenCalledWith(createPlanDto);
      expect(result).toEqual(mockPlan);
    });
  });

  describe('findAll', () => {
    it('should return an array of plans', async () => {
      jest.spyOn(service, 'findAll').mockResolvedValue([mockPlan]);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual([mockPlan]);
    });
  });

  describe('findOne', () => {
    it('should return a single plan', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockPlan);

      const result = await controller.findOne('1');

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(result).toEqual(mockPlan);
    });
  });

  describe('update', () => {
    it('should update a plan', async () => {
      const updatePlanDto: UpdatePlanDto = { name: 'Updated Plan' };
      const updatedPlan = { ...mockPlan, ...updatePlanDto } as Plan;
      jest.spyOn(service, 'update').mockResolvedValue(updatedPlan);

      const result = await controller.update('1', updatePlanDto);

      expect(service.update).toHaveBeenCalledWith('1', updatePlanDto);
      expect(result).toEqual(updatedPlan);
    });
  });

  describe('remove', () => {
    it('should remove a plan', async () => {
      jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      await controller.remove('1');

      expect(service.remove).toHaveBeenCalledWith('1');
    });
  });

  describe('createServicesBatch', () => {
    it('should delegate batch creation to PlanServicesService', async () => {
      const planServicesService = controller['planServicesService'];
      const batchDto = { services: [] };
      jest.spyOn(planServicesService, 'createBatch').mockResolvedValue([]);

      const result = await controller.createServicesBatch('plan-1', batchDto);

      expect(planServicesService.createBatch).toHaveBeenCalledWith('plan-1', batchDto);
      expect(result).toEqual([]);
    });
  });

  describe('createService', () => {
    it('should delegate single service creation to PlanServicesService', async () => {
      const planServicesService = controller['planServicesService'];
      const dto = { medicalServiceId: 'med-1', limitType: PlanServiceLimitType.UNLIMITED };
      const mockCreated = { id: 'ps-1' } as unknown as PlanService;
      jest.spyOn(planServicesService, 'create').mockResolvedValue(mockCreated);

      const result = await controller.createService('plan-1', dto);

      expect(planServicesService.create).toHaveBeenCalledWith('plan-1', dto);
      expect(result).toEqual(mockCreated);
    });
  });

  describe('findServices', () => {
    it('should delegate finding services to PlanServicesService with grouped option', async () => {
      const planServicesService = controller['planServicesService'];
      jest.spyOn(planServicesService, 'findByPlan').mockResolvedValue([]);

      const result = await controller.findServices('plan-1', { grouped: true });

      expect(planServicesService.findByPlan).toHaveBeenCalledWith('plan-1', true);
      expect(result).toEqual([]);
    });
  });

  describe('findService', () => {
    it('should delegate finding one service to PlanServicesService', async () => {
      const planServicesService = controller['planServicesService'];
      const mockPs = { id: 'ps-1' } as unknown as PlanService;
      jest.spyOn(planServicesService, 'findOne').mockResolvedValue(mockPs);

      const result = await controller.findService('plan-1', 'ps-1');

      expect(planServicesService.findOne).toHaveBeenCalledWith('plan-1', 'ps-1');
      expect(result).toEqual(mockPs);
    });
  });

  describe('updateService', () => {
    it('should delegate update to PlanServicesService', async () => {
      const planServicesService = controller['planServicesService'];
      const updateDto = { copayAmount: 25 };
      const mockUpdated = { id: 'ps-1', copayAmount: 25 } as unknown as PlanService;
      jest.spyOn(planServicesService, 'update').mockResolvedValue(mockUpdated);

      const result = await controller.updateService('plan-1', 'ps-1', updateDto);

      expect(planServicesService.update).toHaveBeenCalledWith('plan-1', 'ps-1', updateDto);
      expect(result).toEqual(mockUpdated);
    });
  });

  describe('removeService', () => {
    it('should delegate remove to PlanServicesService', async () => {
      const planServicesService = controller['planServicesService'];
      const mockDeleted = { id: 'ps-1' } as unknown as PlanService;
      jest.spyOn(planServicesService, 'remove').mockResolvedValue(mockDeleted);

      const result = await controller.removeService('plan-1', 'ps-1');

      expect(planServicesService.remove).toHaveBeenCalledWith('plan-1', 'ps-1');
      expect(result).toEqual(mockDeleted);
    });
  });

  describe('cloneServices', () => {
    it('should delegate cloning to PlanCloningService', async () => {
      const planCloningService = controller['planCloningService'];
      const mockResponse = {
        targetPlanId: 'target-1',
        sourcePlanId: 'source-1',
        clonedCount: 2,
        skippedCount: 0,
        clonedServices: [],
      };
      jest.spyOn(planCloningService, 'cloneServices').mockResolvedValue(mockResponse);

      const result = await controller.cloneServices('target-1', 'source-1');

      expect(planCloningService.cloneServices).toHaveBeenCalledWith('target-1', 'source-1');
      expect(result).toEqual(mockResponse);
    });
  });
});
