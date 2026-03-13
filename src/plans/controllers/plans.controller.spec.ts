import { Test, TestingModule } from '@nestjs/testing';
import { PlansController } from './plans.controller';
import { PlansService } from '../services/plans.service';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { Plan } from '../entities/plan.entity';

describe('PlansController', () => {
  let controller: PlansController;
  let service: PlansService;

  const mockPlan: Plan = {
    id: '1',
    name: 'Basic Plan',
    amount: 10,
    maxAge: 30,
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
      const createPlanDto: CreatePlanDto = { name: 'Basic Plan', maxAge: 30, amount: 10 };
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
});
