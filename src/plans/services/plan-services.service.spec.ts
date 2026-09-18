import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  EntityAlreadyExistsException,
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions';
import { BatchCreatePlanServicesDto } from '../dto/batch-create-plan-services.dto';
import { CreatePlanServiceDto } from '../dto/create-plan-service.dto';
import { UpdatePlanServiceDto } from '../dto/update-plan-service.dto';
import { MedicalService } from '../entities/medical-service.entity';
import { PlanService, PlanServiceLimitType } from '../entities/plan-service.entity';
import { Plan, PlanStatus } from '../entities/plan.entity';
import { ServiceCategory } from '../entities/service-category.entity';
import { GroupedCategoryServices, PlanServicesService } from './plan-services.service';

describe('PlanServicesService', () => {
  let service: PlanServicesService;
  let planServiceRepo: jest.Mocked<Repository<PlanService>>;
  let planRepo: jest.Mocked<Repository<Plan>>;
  let medicalServiceRepo: jest.Mocked<Repository<MedicalService>>;

  const mockPlan: Plan = {
    id: 'plan-uuid-1',
    name: 'Plan Oro',
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

  const mockCategory: ServiceCategory = {
    id: 'cat-uuid-1',
    code: 'CAT-01',
    name: 'Consultas Médicas',
    description: 'Consultas generales y especializadas',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockMedicalService: MedicalService = {
    id: 'med-uuid-1',
    code: 'MED-01',
    name: 'Consulta General',
    categoryId: 'cat-uuid-1',
    category: mockCategory,
    linkedHealthCategories: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockPlanService: PlanService = {
    id: 'ps-uuid-1',
    planId: 'plan-uuid-1',
    plan: mockPlan,
    medicalServiceId: 'med-uuid-1',
    medicalService: mockMedicalService,
    limitType: PlanServiceLimitType.UNLIMITED,
    limitQuantity: null,
    waitingPeriodDays: 0,
    copayAmount: 10,
    copayPercentage: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    const repos = {
      plan: null as unknown as jest.Mocked<Repository<Plan>>,
      planService: null as unknown as jest.Mocked<Repository<PlanService>>,
      medicalService: null as unknown as jest.Mocked<Repository<MedicalService>>,
    };

    const mockManager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Plan) return repos.plan;
        if (entity === PlanService) return repos.planService;
        if (entity === MedicalService) return repos.medicalService;
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
        PlanServicesService,
        {
          provide: getRepositoryToken(PlanService),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Plan),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(MedicalService),
          useValue: {
            findOne: jest.fn(),
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

    service = module.get<PlanServicesService>(PlanServicesService);
    planServiceRepo = module.get(getRepositoryToken(PlanService));
    planRepo = module.get(getRepositoryToken(Plan));
    medicalServiceRepo = module.get(getRepositoryToken(MedicalService));

    repos.plan = planRepo;
    repos.planService = planServiceRepo;
    repos.medicalService = medicalServiceRepo;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw EntityNotFoundException if plan does not exist', async () => {
      planRepo.findOne.mockResolvedValue(null);

      const dto: CreatePlanServiceDto = {
        medicalServiceId: 'med-uuid-1',
        limitType: PlanServiceLimitType.UNLIMITED,
      };

      await expect(service.create('ghost-plan', dto)).rejects.toThrow(EntityNotFoundException);
    });

    it('should throw EntityNotFoundException if medical service does not exist', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      medicalServiceRepo.findOne.mockResolvedValue(null);

      const dto: CreatePlanServiceDto = {
        medicalServiceId: 'ghost-med',
        limitType: PlanServiceLimitType.UNLIMITED,
      };

      await expect(service.create('plan-uuid-1', dto)).rejects.toThrow(EntityNotFoundException);
    });

    it('should throw InvalidDomainOperationException if UNLIMITED has non-null limitQuantity', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);

      const dto: CreatePlanServiceDto = {
        medicalServiceId: 'med-uuid-1',
        limitType: PlanServiceLimitType.UNLIMITED,
        limitQuantity: 5,
      };

      await expect(service.create('plan-uuid-1', dto)).rejects.toThrow(
        InvalidDomainOperationException,
      );
    });

    it('should throw InvalidDomainOperationException if MONTHLY has null limitQuantity', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);

      const dto: CreatePlanServiceDto = {
        medicalServiceId: 'med-uuid-1',
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: null,
      };

      await expect(service.create('plan-uuid-1', dto)).rejects.toThrow(
        InvalidDomainOperationException,
      );
    });

    it('should throw InvalidDomainOperationException if MONTHLY has limitQuantity < 1', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);

      const dto: CreatePlanServiceDto = {
        medicalServiceId: 'med-uuid-1',
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: 0,
      };

      await expect(service.create('plan-uuid-1', dto)).rejects.toThrow(
        InvalidDomainOperationException,
      );
    });

    it('should throw InvalidDomainOperationException if ANNUAL has undefined limitQuantity', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);

      const dto: CreatePlanServiceDto = {
        medicalServiceId: 'med-uuid-1',
        limitType: PlanServiceLimitType.ANNUAL,
      };

      await expect(service.create('plan-uuid-1', dto)).rejects.toThrow(
        InvalidDomainOperationException,
      );
    });

    it('should throw EntityAlreadyExistsException if service is already assigned to the plan', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);
      planServiceRepo.findOne.mockResolvedValue(mockPlanService);

      const dto: CreatePlanServiceDto = {
        medicalServiceId: 'med-uuid-1',
        limitType: PlanServiceLimitType.UNLIMITED,
      };

      await expect(service.create('plan-uuid-1', dto)).rejects.toThrow(
        EntityAlreadyExistsException,
      );
    });

    it('should create plan service successfully with valid UNLIMITED params', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);
      planServiceRepo.findOne.mockResolvedValue(null);
      planServiceRepo.create.mockReturnValue(mockPlanService);
      planServiceRepo.save.mockResolvedValue(mockPlanService);

      const dto: CreatePlanServiceDto = {
        medicalServiceId: 'med-uuid-1',
        limitType: PlanServiceLimitType.UNLIMITED,
        limitQuantity: null,
        waitingPeriodDays: 30,
        copayAmount: 15,
        copayPercentage: 10,
      };

      const result = await service.create('plan-uuid-1', dto);

      expect(planServiceRepo.create).toHaveBeenCalledWith({
        planId: 'plan-uuid-1',
        medicalServiceId: 'med-uuid-1',
        limitType: PlanServiceLimitType.UNLIMITED,
        limitQuantity: null,
        waitingPeriodDays: 30,
        copayAmount: 15,
        copayPercentage: 10,
      });
      expect(result).toEqual(mockPlanService);
    });

    it('should create plan service successfully with MONTHLY limitQuantity >= 1', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);
      planServiceRepo.findOne.mockResolvedValue(null);

      const monthlyService = {
        ...mockPlanService,
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: 2,
      };
      planServiceRepo.create.mockReturnValue(monthlyService);
      planServiceRepo.save.mockResolvedValue(monthlyService);

      const dto: CreatePlanServiceDto = {
        medicalServiceId: 'med-uuid-1',
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: 2,
      };

      const result = await service.create('plan-uuid-1', dto);

      expect(planServiceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          limitType: PlanServiceLimitType.MONTHLY,
          limitQuantity: 2,
        }),
      );
      expect(result).toEqual(monthlyService);
    });
  });

  describe('createBatch', () => {
    it('should throw EntityNotFoundException if plan does not exist', async () => {
      planRepo.findOne.mockResolvedValue(null);

      const dto: BatchCreatePlanServicesDto = {
        services: [
          {
            medicalServiceId: 'med-uuid-1',
            limitType: PlanServiceLimitType.UNLIMITED,
          },
        ],
      };

      await expect(service.createBatch('ghost-plan', dto)).rejects.toThrow(EntityNotFoundException);
    });

    it('should throw InvalidDomainOperationException if duplicated service ID in batch', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);

      const dto: BatchCreatePlanServicesDto = {
        services: [
          {
            medicalServiceId: 'med-uuid-1',
            limitType: PlanServiceLimitType.UNLIMITED,
          },
          {
            medicalServiceId: 'med-uuid-1',
            limitType: PlanServiceLimitType.MONTHLY,
            limitQuantity: 2,
          },
        ],
      };

      await expect(service.createBatch('plan-uuid-1', dto)).rejects.toThrow(
        InvalidDomainOperationException,
      );
    });

    it('should throw EntityAlreadyExistsException if any service is already in the plan', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.find.mockResolvedValue([mockPlanService]);

      const dto: BatchCreatePlanServicesDto = {
        services: [
          {
            medicalServiceId: 'med-uuid-1',
            limitType: PlanServiceLimitType.MONTHLY,
            limitQuantity: 3,
          },
        ],
      };

      await expect(service.createBatch('plan-uuid-1', dto)).rejects.toThrow(
        EntityAlreadyExistsException,
      );
    });

    it('should throw EntityNotFoundException if a medical service does not exist', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.find.mockResolvedValue([]);
      medicalServiceRepo.findOne.mockResolvedValue(null);

      const dto: BatchCreatePlanServicesDto = {
        services: [
          {
            medicalServiceId: 'ghost-med',
            limitType: PlanServiceLimitType.UNLIMITED,
          },
        ],
      };

      await expect(service.createBatch('plan-uuid-1', dto)).rejects.toThrow(
        EntityNotFoundException,
      );
    });

    it('should successfully save multiple services in batch', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.find.mockResolvedValue([]);
      medicalServiceRepo.findOne.mockResolvedValue(mockMedicalService);
      planServiceRepo.create.mockReturnValue(mockPlanService);
      planServiceRepo.save.mockResolvedValue([mockPlanService] as unknown as PlanService);

      const dto: BatchCreatePlanServicesDto = {
        services: [
          {
            medicalServiceId: 'med-uuid-1',
            limitType: PlanServiceLimitType.UNLIMITED,
            limitQuantity: null,
            waitingPeriodDays: 0,
            copayAmount: 5,
            copayPercentage: 0,
          },
        ],
      };

      const result = await service.createBatch('plan-uuid-1', dto);

      expect(planServiceRepo.save).toHaveBeenCalled();
      expect(result).toEqual([mockPlanService]);
    });
  });

  describe('findByPlan', () => {
    it('should throw EntityNotFoundException if plan does not exist', async () => {
      planRepo.findOne.mockResolvedValue(null);

      await expect(service.findByPlan('ghost-plan')).rejects.toThrow(EntityNotFoundException);
    });

    it('should return flat array when grouped is false', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.find.mockResolvedValue([mockPlanService]);

      const result = await service.findByPlan('plan-uuid-1', false);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([mockPlanService]);
    });

    it('should return category-grouped array when grouped is true', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.find.mockResolvedValue([mockPlanService]);

      const result = await service.findByPlan('plan-uuid-1', true);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      const group = (result as GroupedCategoryServices[])[0];
      expect(group.category.id).toBe('cat-uuid-1');
      expect(group.category.name).toBe('Consultas Médicas');
      expect(group.services).toHaveLength(1);
      expect(group.services[0].id).toBe('ps-uuid-1');
    });
  });

  describe('findOne', () => {
    it('should throw EntityNotFoundException if plan does not exist', async () => {
      planRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('ghost-plan', 'ps-uuid-1')).rejects.toThrow(
        EntityNotFoundException,
      );
    });

    it('should throw EntityNotFoundException if plan service does not exist', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('plan-uuid-1', 'ghost-ps')).rejects.toThrow(
        EntityNotFoundException,
      );
    });

    it('should return plan service when found', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.findOne.mockResolvedValue(mockPlanService);

      const result = await service.findOne('plan-uuid-1', 'ps-uuid-1');

      expect(result).toEqual(mockPlanService);
    });
  });

  describe('update', () => {
    it('should update copay and limits successfully', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.findOne.mockResolvedValue({ ...mockPlanService });
      planServiceRepo.save.mockImplementation(async (entity) => entity as PlanService);

      const updateDto: UpdatePlanServiceDto = {
        copayAmount: 25,
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: 3,
      };

      const result = await service.update('plan-uuid-1', 'ps-uuid-1', updateDto);

      expect(result.copayAmount).toBe(25);
      expect(result.limitType).toBe(PlanServiceLimitType.MONTHLY);
      expect(result.limitQuantity).toBe(3);
    });

    it('should throw InvalidDomainOperationException if update introduces invalid limits', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.findOne.mockResolvedValue({ ...mockPlanService });

      const updateDto: UpdatePlanServiceDto = {
        limitType: PlanServiceLimitType.UNLIMITED,
        limitQuantity: 10,
      };

      await expect(service.update('plan-uuid-1', 'ps-uuid-1', updateDto)).rejects.toThrow(
        InvalidDomainOperationException,
      );
    });

    it('should throw EntityAlreadyExistsException if updating medicalServiceId to already existing service', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.findOne.mockResolvedValueOnce({ ...mockPlanService }).mockResolvedValueOnce({
        id: 'ps-other',
        medicalServiceId: 'med-2',
      } as unknown as PlanService);
      medicalServiceRepo.findOne.mockResolvedValue({ id: 'med-2' } as unknown as MedicalService);

      const updateDto: UpdatePlanServiceDto = {
        medicalServiceId: 'med-2',
      };

      await expect(service.update('plan-uuid-1', 'ps-uuid-1', updateDto)).rejects.toThrow(
        EntityAlreadyExistsException,
      );
    });
  });

  describe('remove', () => {
    it('should soft delete plan service', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan);
      planServiceRepo.findOne.mockResolvedValue(mockPlanService);
      planServiceRepo.softRemove.mockResolvedValue(mockPlanService);

      const result = await service.remove('plan-uuid-1', 'ps-uuid-1');

      expect(planServiceRepo.softRemove).toHaveBeenCalledWith(mockPlanService);
      expect(result).toEqual(mockPlanService);
    });
  });
});
