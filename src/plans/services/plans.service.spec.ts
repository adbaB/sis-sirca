import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PlansService } from './plans.service';
import { Plan } from '../entities/plan.entity';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { NotFoundException } from '@nestjs/common';

describe('PlansService', () => {
  let service: PlansService;
  let repository: Repository<Plan>;

  const mockPlan: Plan = {
    id: '1',
    name: 'Basic Plan',
    maxAge: 30,
    amount: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    persons: [],
  };

  const PLANS_REPOSITORY_TOKEN = getRepositoryToken(Plan);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        {
          provide: PLANS_REPOSITORY_TOKEN,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PlansService>(PlansService);
    repository = module.get<Repository<Plan>>(PLANS_REPOSITORY_TOKEN);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully insert a plan', async () => {
      const createPlanDto: CreatePlanDto = {
        name: 'Basic Plan',
        maxAge: 30,
        amount: 10,
      };

      jest.spyOn(repository, 'create').mockReturnValue(mockPlan);
      jest.spyOn(repository, 'save').mockResolvedValue(mockPlan);

      const result = await service.create(createPlanDto);

      expect(repository.create).toHaveBeenCalledWith(createPlanDto);
      expect(repository.save).toHaveBeenCalledWith(mockPlan);
      expect(result).toEqual(mockPlan);
    });
  });

  describe('findAll', () => {
    it('should return an array of plans', async () => {
      jest.spyOn(repository, 'find').mockResolvedValue([mockPlan]);

      const result = await service.findAll();

      expect(repository.find).toHaveBeenCalled();
      expect(result).toEqual([mockPlan]);
    });
  });

  describe('findOne', () => {
    it('should return a plan if it exists', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockPlan);

      const result = await service.findOne('1');

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
      expect(result).toEqual(mockPlan);
    });

    it('should throw NotFoundException if plan does not exist', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await expect(service.findOne('2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return a plan', async () => {
      const updatePlanDto: UpdatePlanDto = { name: 'Updated Plan' };
      const updatedPlan = { ...mockPlan, ...updatePlanDto };

      jest.spyOn(service, 'findOne').mockResolvedValue(mockPlan);
      jest.spyOn(repository, 'save').mockResolvedValue(updatedPlan as Plan);

      const result = await service.update('1', updatePlanDto);

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(repository.save).toHaveBeenCalled();
      expect(result.name).toEqual('Updated Plan');
    });
  });

  describe('remove', () => {
    it('should soft remove a plan', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockPlan);
      jest.spyOn(repository, 'softRemove').mockResolvedValue(mockPlan);

      await service.remove('1');

      expect(service.findOne).toHaveBeenCalledWith('1');
      expect(repository.softRemove).toHaveBeenCalledWith(mockPlan);
    });
  });
});
