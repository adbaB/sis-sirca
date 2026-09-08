import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EntityNotFoundException, InvalidDomainOperationException } from '../../common/exceptions';
import { MedicalService } from '../entities/medical-service.entity';
import { PlanService, PlanServiceLimitType } from '../entities/plan-service.entity';
import { Plan, PlanStatus } from '../entities/plan.entity';
import { PlanCloningService } from './plan-cloning.service';

describe('PlanCloningService', () => {
  let service: PlanCloningService;
  let planRepo: jest.Mocked<Repository<Plan>>;
  let planServiceRepo: jest.Mocked<Repository<PlanService>>;

  const mockTargetPlan: Plan = {
    id: 'target-plan-id',
    name: 'Plan 2027',
    amount: 120,
    coverage: 15000,
    minAge: 0,
    maxAge: 70,
    minMonths: 12,
    commissionAmount: 12,
    status: PlanStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    persons: [],
  };

  const mockSourcePlan: Plan = {
    id: 'source-plan-id',
    name: 'Plan 2026',
    amount: 100,
    coverage: 10000,
    minAge: 0,
    maxAge: 70,
    minMonths: 12,
    commissionAmount: 10,
    status: PlanStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    persons: [],
  };

  const mockSourceService1: PlanService = {
    id: 'src-ps-1',
    planId: 'source-plan-id',
    plan: mockSourcePlan,
    medicalServiceId: 'med-1',
    medicalService: null as unknown as MedicalService,
    limitType: PlanServiceLimitType.MONTHLY,
    limitQuantity: 2,
    waitingPeriodDays: 15,
    copayAmount: 10,
    copayPercentage: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockSourceService2: PlanService = {
    id: 'src-ps-2',
    planId: 'source-plan-id',
    plan: mockSourcePlan,
    medicalServiceId: 'med-2',
    medicalService: null as unknown as MedicalService,
    limitType: PlanServiceLimitType.UNLIMITED,
    limitQuantity: null,
    waitingPeriodDays: 0,
    copayAmount: 5,
    copayPercentage: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    const repos = {
      plan: null as unknown as jest.Mocked<Repository<Plan>>,
      planService: null as unknown as jest.Mocked<Repository<PlanService>>,
    };

    const mockManager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Plan) return repos.plan;
        if (entity === PlanService) return repos.planService;
        return {};
      }),
    };

    const mockQr = {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanCloningService,
        {
          provide: getRepositoryToken(Plan),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlanService),
          useValue: {
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(mockQr),
          },
        },
      ],
    }).compile();

    service = module.get<PlanCloningService>(PlanCloningService);
    planRepo = module.get(getRepositoryToken(Plan));
    planServiceRepo = module.get(getRepositoryToken(PlanService));

    repos.plan = planRepo;
    repos.planService = planServiceRepo;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cloneServices', () => {
    it('should throw InvalidDomainOperationException when targetPlanId === sourcePlanId (self-cloning)', async () => {
      await expect(service.cloneServices('same-plan-id', 'same-plan-id')).rejects.toThrow(
        InvalidDomainOperationException,
      );

      await expect(service.cloneServices('same-plan-id', 'same-plan-id')).rejects.toThrow(
        'sobre sí mismo',
      );
    });

    it('should throw EntityNotFoundException if target plan does not exist', async () => {
      planRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(mockSourcePlan);

      await expect(service.cloneServices('ghost-target', 'source-plan-id')).rejects.toThrow(
        EntityNotFoundException,
      );
    });

    it('should throw EntityNotFoundException if source plan does not exist', async () => {
      planRepo.findOne.mockResolvedValueOnce(mockTargetPlan).mockResolvedValueOnce(null);

      await expect(service.cloneServices('target-plan-id', 'ghost-source')).rejects.toThrow(
        EntityNotFoundException,
      );
    });

    it('should return 0 cloned and 0 skipped if source plan has no services', async () => {
      planRepo.findOne.mockResolvedValueOnce(mockTargetPlan).mockResolvedValueOnce(mockSourcePlan);
      planServiceRepo.find.mockResolvedValue([]);

      const result = await service.cloneServices('target-plan-id', 'source-plan-id');

      expect(result).toEqual({
        targetPlanId: 'target-plan-id',
        sourcePlanId: 'source-plan-id',
        clonedCount: 0,
        skippedCount: 0,
        clonedServices: [],
      });
      expect(planServiceRepo.save).not.toHaveBeenCalled();
    });

    it('should clone all services when target plan has no existing services', async () => {
      planRepo.findOne.mockResolvedValueOnce(mockTargetPlan).mockResolvedValueOnce(mockSourcePlan);

      planServiceRepo.find
        .mockResolvedValueOnce([mockSourceService1, mockSourceService2]) // source services
        .mockResolvedValueOnce([]); // target existing services

      const createdService1 = {
        ...mockSourceService1,
        id: 'new-ps-1',
        planId: 'target-plan-id',
      } as PlanService;
      const createdService2 = {
        ...mockSourceService2,
        id: 'new-ps-2',
        planId: 'target-plan-id',
      } as PlanService;

      planServiceRepo.create
        .mockReturnValueOnce(createdService1)
        .mockReturnValueOnce(createdService2);

      (planServiceRepo.save as jest.Mock).mockResolvedValue([createdService1, createdService2]);

      const result = await service.cloneServices('target-plan-id', 'source-plan-id');

      expect(result.clonedCount).toBe(2);
      expect(result.skippedCount).toBe(0);
      expect(result.clonedServices).toEqual([createdService1, createdService2]);
      expect(planServiceRepo.create).toHaveBeenCalledWith({
        planId: 'target-plan-id',
        medicalServiceId: 'med-1',
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: 2,
        waitingPeriodDays: 15,
        copayAmount: 10,
        copayPercentage: 0,
      });
    });

    it('should skip services that already exist in target plan and clone only new ones', async () => {
      planRepo.findOne.mockResolvedValueOnce(mockTargetPlan).mockResolvedValueOnce(mockSourcePlan);

      const existingTargetService: PlanService = {
        id: 'existing-ps-target',
        planId: 'target-plan-id',
        plan: mockTargetPlan,
        medicalServiceId: 'med-1', // Already has med-1
        medicalService: null as unknown as MedicalService,
        limitType: PlanServiceLimitType.ANNUAL,
        limitQuantity: 10,
        waitingPeriodDays: 0,
        copayAmount: 50,
        copayPercentage: 20,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      planServiceRepo.find
        .mockResolvedValueOnce([mockSourceService1, mockSourceService2]) // source has med-1 & med-2
        .mockResolvedValueOnce([existingTargetService]); // target has med-1

      const createdService2 = {
        ...mockSourceService2,
        id: 'new-ps-2',
        planId: 'target-plan-id',
      } as PlanService;

      planServiceRepo.create.mockReturnValueOnce(createdService2);
      (planServiceRepo.save as jest.Mock).mockResolvedValue([createdService2]);

      const result = await service.cloneServices('target-plan-id', 'source-plan-id');

      expect(result.clonedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.clonedServices).toEqual([createdService2]);
    });

    it('should be idempotent and skip all when all source services are already present', async () => {
      planRepo.findOne.mockResolvedValueOnce(mockTargetPlan).mockResolvedValueOnce(mockSourcePlan);

      const existingTarget1 = {
        id: 'target-1',
        medicalServiceId: 'med-1',
      } as PlanService;
      const existingTarget2 = {
        id: 'target-2',
        medicalServiceId: 'med-2',
      } as PlanService;

      planServiceRepo.find
        .mockResolvedValueOnce([mockSourceService1, mockSourceService2])
        .mockResolvedValueOnce([existingTarget1, existingTarget2]);

      const result = await service.cloneServices('target-plan-id', 'source-plan-id');

      expect(result.clonedCount).toBe(0);
      expect(result.skippedCount).toBe(2);
      expect(result.clonedServices).toEqual([]);
      expect(planServiceRepo.save).not.toHaveBeenCalled();
    });
  });
});
