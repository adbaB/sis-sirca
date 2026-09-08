import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { HealthExclusionsService } from './health-exclusions.service';
import { ContractPersonExclusion } from '../entities/contract-person-exclusion.entity';
import { ContractPerson } from '../entities/contract-person.entity';
import { HealthCategory } from '../entities/health-declaration.entity';
import { ExclusionSource } from '../entities/exclusion-source.enum';
import { MedicalServicesService } from '../../plans/services/medical-services.service';
import { PlanServicesService } from '../../plans/services/plan-services.service';
import { MedicalService } from '../../plans/entities/medical-service.entity';
import { PlanService } from '../../plans/entities/plan-service.entity';
import { ServiceCategory } from '../../plans/entities/service-category.entity';
import { InvalidDomainOperationException } from '../../common/exceptions';

describe('HealthExclusionsService', () => {
  let service: HealthExclusionsService;
  let exclusionRepo: jest.Mocked<Repository<ContractPersonExclusion>>;
  let medicalServicesService: jest.Mocked<MedicalServicesService>;
  let planServicesService: jest.Mocked<PlanServicesService>;

  const mockContractPerson = {
    id: 'cp-uuid-1',
  } as ContractPerson;

  const mockMedicalService1: MedicalService = {
    id: 'ms-uuid-1',
    code: 'ECG-001',
    name: 'Electrocardiograma',
    categoryId: 'cat-uuid-1',
    category: { id: 'cat-uuid-1', code: 'CARD', name: 'Cardiología' } as ServiceCategory,
    linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockMedicalService2: MedicalService = {
    id: 'ms-uuid-2',
    code: 'GLUC-001',
    name: 'Glicemia en ayunas',
    categoryId: 'cat-uuid-2',
    category: { id: 'cat-uuid-2', code: 'LAB', name: 'Laboratorio' } as ServiceCategory,
    linkedHealthCategories: [HealthCategory.CARDIOVASCULAR, HealthCategory.ENDOCRINA],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthExclusionsService,
        {
          provide: getRepositoryToken(ContractPersonExclusion),
          useValue: {
            create: jest.fn().mockImplementation((dto) => ({ id: 'ex-saved', ...dto })),
            save: jest.fn().mockImplementation(async (entities) => entities),
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: MedicalServicesService,
          useValue: {
            findByHealthCategories: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
          },
        },
        {
          provide: PlanServicesService,
          useValue: {
            findByPlan: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<HealthExclusionsService>(HealthExclusionsService);
    exclusionRepo = module.get(getRepositoryToken(ContractPersonExclusion));
    medicalServicesService = module.get(MedicalServicesService);
    planServicesService = module.get(PlanServicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. evaluateHealthExclusions
  // ─────────────────────────────────────────────────────────────────────────────
  describe('evaluateHealthExclusions', () => {
    it('should return empty suggestions when no conditions are declared or hasCondition is false', async () => {
      const result = await service.evaluateHealthExclusions({
        healthDeclarations: [
          { category: HealthCategory.CARDIOVASCULAR, hasCondition: false },
          { category: HealthCategory.RESPIRATORIA, hasCondition: false },
        ],
      });

      expect(result.suggestedExclusions).toHaveLength(0);
      expect(result.manualExclusions).toHaveLength(0);
      expect(result.allExclusions).toHaveLength(0);
      expect(result.summary.totalConditionsDeclared).toBe(0);
      expect(result.summary.totalServicesExcluded).toBe(0);
      expect(result.summary.hasManualModifications).toBe(false);
      expect(medicalServicesService.findByHealthCategories).not.toHaveBeenCalled();
    });

    it('should handle undefined or empty healthDeclarations gracefully', async () => {
      const result = await service.evaluateHealthExclusions({
        healthDeclarations: [],
      });

      expect(result.suggestedExclusions).toEqual([]);
      expect(result.allExclusions).toEqual([]);
      expect(result.summary.totalConditionsDeclared).toBe(0);
    });

    it('should find medical services linked to declared health categories and generate automatic reasons', async () => {
      medicalServicesService.findByHealthCategories.mockResolvedValue([mockMedicalService1]);

      const result = await service.evaluateHealthExclusions({
        healthDeclarations: [
          {
            category: HealthCategory.CARDIOVASCULAR,
            hasCondition: true,
            details: 'Hipertensión grado 1',
          },
        ],
      });

      expect(medicalServicesService.findByHealthCategories).toHaveBeenCalledWith([
        HealthCategory.CARDIOVASCULAR,
      ]);
      expect(result.suggestedExclusions).toHaveLength(1);
      const suggested = result.suggestedExclusions[0];
      expect(suggested.medicalServiceId).toBe(mockMedicalService1.id);
      expect(suggested.medicalServiceCode).toBe(mockMedicalService1.code);
      expect(suggested.medicalServiceName).toBe(mockMedicalService1.name);
      expect(suggested.serviceCategoryId).toBe(mockMedicalService1.categoryId);
      expect(suggested.serviceCategoryName).toBe('Cardiología');
      expect(suggested.source).toBe(ExclusionSource.AUTOMATIC);
      expect(suggested.isManualOverride).toBe(false);
      expect(suggested.reason).toContain('CARDIOVASCULAR');
      expect(suggested.reason).toContain('Hipertensión grado 1');
      expect(suggested.inPlan).toBeUndefined();
      expect(result.summary.totalConditionsDeclared).toBe(1);
      expect(result.summary.totalServicesExcluded).toBe(1);
    });

    it('should handle declared condition without details', async () => {
      medicalServicesService.findByHealthCategories.mockResolvedValue([mockMedicalService1]);

      const result = await service.evaluateHealthExclusions({
        healthDeclarations: [{ category: HealthCategory.CARDIOVASCULAR, hasCondition: true }],
      });

      expect(result.suggestedExclusions).toHaveLength(1);
      expect(result.suggestedExclusions[0].reason).toContain('CARDIOVASCULAR');
      expect(result.suggestedExclusions[0].reason).not.toContain('(');
    });

    it('should handle service linked to multiple declared pathologies and consolidate reasons', async () => {
      medicalServicesService.findByHealthCategories.mockResolvedValue([mockMedicalService2]);

      const result = await service.evaluateHealthExclusions({
        healthDeclarations: [
          {
            category: HealthCategory.CARDIOVASCULAR,
            hasCondition: true,
            details: 'Palpitaciones',
          },
          { category: HealthCategory.ENDOCRINA, hasCondition: true },
        ],
      });

      expect(result.suggestedExclusions).toHaveLength(1);
      const item = result.suggestedExclusions[0];
      expect(item.medicalServiceId).toBe(mockMedicalService2.id);
      expect(item.reason).toContain('CARDIOVASCULAR');
      expect(item.reason).toContain('ENDOCRINA');
    });

    it('should skip services that do not actually link to any of the active declarations', async () => {
      const unrelatedService: MedicalService = {
        ...mockMedicalService1,
        id: 'ms-unrelated',
        linkedHealthCategories: [HealthCategory.DIGESTIVA],
      };
      medicalServicesService.findByHealthCategories.mockResolvedValue([unrelatedService]);

      const result = await service.evaluateHealthExclusions({
        healthDeclarations: [{ category: HealthCategory.CARDIOVASCULAR, hasCondition: true }],
      });

      expect(result.suggestedExclusions).toHaveLength(0);
    });

    it('should tag inPlan true/false when planId is provided', async () => {
      medicalServicesService.findByHealthCategories.mockResolvedValue([
        mockMedicalService1,
        mockMedicalService2,
      ]);
      planServicesService.findByPlan.mockResolvedValue([
        { medicalServiceId: mockMedicalService1.id } as PlanService,
      ]);

      const result = await service.evaluateHealthExclusions({
        planId: 'plan-1',
        healthDeclarations: [{ category: HealthCategory.CARDIOVASCULAR, hasCondition: true }],
      });

      expect(planServicesService.findByPlan).toHaveBeenCalledWith('plan-1');
      const item1 = result.suggestedExclusions.find(
        (s) => s.medicalServiceId === mockMedicalService1.id,
      );
      const item2 = result.suggestedExclusions.find(
        (s) => s.medicalServiceId === mockMedicalService2.id,
      );
      expect(item1?.inPlan).toBe(true);
      expect(item2?.inPlan).toBe(false);
    });

    it('should reconcile manual overrides replacing automatic suggestions and adding new exclusions', async () => {
      medicalServicesService.findByHealthCategories.mockResolvedValue([
        mockMedicalService1,
        mockMedicalService2,
      ]);
      planServicesService.findByPlan.mockResolvedValue([
        { medicalServiceId: mockMedicalService1.id } as PlanService,
        { medicalServiceId: 'ms-uuid-3' } as PlanService,
      ]);

      const result = await service.evaluateHealthExclusions({
        planId: 'plan-1',
        healthDeclarations: [{ category: HealthCategory.CARDIOVASCULAR, hasCondition: true }],
        manualExclusions: [
          // Override of mockMedicalService1
          {
            medicalServiceId: mockMedicalService1.id,
            reason: 'Motivo modificado por auditor médico',
            source: ExclusionSource.MANUAL,
          },
          // Manual addition of an un-suggested service
          {
            medicalServiceId: 'ms-uuid-3',
            reason: 'Exclusión preventiva adicional',
            source: ExclusionSource.MANUAL,
          },
          // Category-wide exclusion
          {
            serviceCategoryId: 'cat-uuid-3',
            reason: 'Exclusión completa de categoría odontológica',
            source: ExclusionSource.MANUAL,
          },
        ],
      });

      expect(result.suggestedExclusions).toHaveLength(2);
      expect(result.manualExclusions).toHaveLength(3);

      // allExclusions should have mockMedicalService2 (not overridden) + 3 manual exclusions = 4
      expect(result.allExclusions).toHaveLength(4);

      const overridden = result.allExclusions.find(
        (e) => e.medicalServiceId === mockMedicalService1.id,
      );
      expect(overridden?.isManualOverride).toBe(true);
      expect(overridden?.reason).toBe('Motivo modificado por auditor médico');
      expect(overridden?.source).toBe(ExclusionSource.MANUAL);
      expect(overridden?.medicalServiceName).toBe(mockMedicalService1.name);
      expect(overridden?.inPlan).toBe(true);

      const additional = result.allExclusions.find((e) => e.medicalServiceId === 'ms-uuid-3');
      expect(additional?.isManualOverride).toBe(true);
      expect(additional?.reason).toBe('Exclusión preventiva adicional');
      expect(additional?.inPlan).toBe(true);

      const categoryExclusion = result.allExclusions.find(
        (e) => e.serviceCategoryId === 'cat-uuid-3',
      );
      expect(categoryExclusion?.reason).toBe('Exclusión completa de categoría odontológica');

      expect(result.summary.hasManualModifications).toBe(true);
      expect(result.summary.totalServicesExcluded).toBe(4);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. detectAndPersistExclusions
  // ─────────────────────────────────────────────────────────────────────────────
  describe('detectAndPersistExclusions', () => {
    it('should persist explicit exclusions directly when explicitExclusions is passed', async () => {
      const explicit = [
        {
          medicalServiceId: 'ms-1',
          reason: 'Exclusión explícita',
          source: ExclusionSource.MANUAL,
        },
      ];

      const res = await service.detectAndPersistExclusions(mockContractPerson, [], explicit);

      expect(res).toBeDefined();
      expect(exclusionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contractPerson: mockContractPerson,
          contractPersonId: mockContractPerson.id,
          medicalServiceId: 'ms-1',
          reason: 'Exclusión explícita',
          source: ExclusionSource.MANUAL,
        }),
      );
      expect(exclusionRepo.save).toHaveBeenCalled();
    });

    it('should return empty array and persist nothing when explicitExclusions is an empty array []', async () => {
      const res = await service.detectAndPersistExclusions(mockContractPerson, [], []);

      expect(res).toEqual([]);
      expect(exclusionRepo.save).not.toHaveBeenCalled();
    });

    it('should auto-detect and persist exclusions when explicitExclusions is undefined', async () => {
      medicalServicesService.findByHealthCategories.mockResolvedValue([mockMedicalService1]);

      const res = await service.detectAndPersistExclusions(
        mockContractPerson,
        [{ category: HealthCategory.CARDIOVASCULAR, hasCondition: true }],
        undefined,
      );

      expect(res).toBeDefined();
      expect(exclusionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contractPerson: mockContractPerson,
          medicalServiceId: mockMedicalService1.id,
          source: ExclusionSource.AUTOMATIC,
        }),
      );
      expect(exclusionRepo.save).toHaveBeenCalled();
    });

    it('should return empty array when explicitExclusions is undefined and no conditions declared', async () => {
      const res = await service.detectAndPersistExclusions(
        mockContractPerson,
        [{ category: HealthCategory.CARDIOVASCULAR, hasCondition: false }],
        undefined,
      );

      expect(res).toEqual([]);
      expect(exclusionRepo.save).not.toHaveBeenCalled();
    });

    it('should use manager repository when manager is provided', async () => {
      const mockManagerRepo = {
        create: jest.fn().mockImplementation((dto) => dto),
        save: jest.fn().mockImplementation(async (entities) => entities),
      };
      const mockManager = {
        getRepository: jest.fn().mockReturnValue(mockManagerRepo),
      } as unknown as EntityManager;

      const explicit = [
        {
          medicalServiceId: 'ms-1',
          reason: 'Exclusión explícita con manager',
          source: ExclusionSource.MANUAL,
        },
      ];

      const res = await service.detectAndPersistExclusions(
        mockContractPerson,
        [],
        explicit,
        mockManager,
      );

      expect(mockManager.getRepository).toHaveBeenCalledWith(ContractPersonExclusion);
      expect(mockManagerRepo.save).toHaveBeenCalled();
      expect(exclusionRepo.save).not.toHaveBeenCalled();
      expect(res).toBeDefined();
    });

    it('should throw InvalidDomainOperationException if an exclusion specifies neither medicalServiceId nor serviceCategoryId', async () => {
      await expect(
        service.detectAndPersistExclusions(
          mockContractPerson,
          [],
          [
            {
              reason: 'Sin servicio ni categoría',
            },
          ],
        ),
      ).rejects.toThrow(InvalidDomainOperationException);
    });

    it('should deduplicate items within the same batch having the same service and category', async () => {
      const explicit = [
        {
          medicalServiceId: 'ms-1',
          reason: 'Primera',
          source: ExclusionSource.MANUAL,
        },
        {
          medicalServiceId: 'ms-1',
          reason: 'Duplicada',
          source: ExclusionSource.MANUAL,
        },
      ];

      await service.detectAndPersistExclusions(mockContractPerson, [], explicit);

      expect(exclusionRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. replaceExclusions
  // ─────────────────────────────────────────────────────────────────────────────
  describe('replaceExclusions', () => {
    it('should delete existing exclusions for contract person and save new ones', async () => {
      const newExclusions = [
        {
          medicalServiceId: 'ms-replacement',
          reason: 'Nuevo motivo',
          source: ExclusionSource.MANUAL,
        },
      ];

      const res = await service.replaceExclusions(mockContractPerson, newExclusions);

      expect(exclusionRepo.delete).toHaveBeenCalledWith({
        contractPersonId: mockContractPerson.id,
      });
      expect(exclusionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contractPersonId: mockContractPerson.id,
          medicalServiceId: 'ms-replacement',
        }),
      );
      expect(exclusionRepo.save).toHaveBeenCalled();
      expect(res).toBeDefined();
    });

    it('should work within a provided manager transaction', async () => {
      const mockManagerRepo = {
        delete: jest.fn().mockResolvedValue({ affected: 2 }),
        create: jest.fn().mockImplementation((dto) => dto),
        save: jest.fn().mockImplementation(async (entities) => entities),
      };
      const mockManager = {
        getRepository: jest.fn().mockReturnValue(mockManagerRepo),
      } as unknown as EntityManager;

      await service.replaceExclusions(mockContractPerson, [], mockManager);

      expect(mockManager.getRepository).toHaveBeenCalledWith(ContractPersonExclusion);
      expect(mockManagerRepo.delete).toHaveBeenCalledWith({
        contractPersonId: mockContractPerson.id,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. resyncAutomaticExclusions
  // ─────────────────────────────────────────────────────────────────────────────
  describe('resyncAutomaticExclusions', () => {
    it('should delete AUTOMATIC exclusions, preserve MANUAL ones, and return existingManual if no new conditions', async () => {
      const existingManual = [
        {
          id: 'manual-1',
          contractPersonId: mockContractPerson.id,
          medicalServiceId: 'ms-manual-1',
          reason: 'Exclusión manual previa',
          source: ExclusionSource.MANUAL,
        } as ContractPersonExclusion,
      ];

      exclusionRepo.find.mockResolvedValue(existingManual);

      const res = await service.resyncAutomaticExclusions(mockContractPerson, [
        { category: HealthCategory.CARDIOVASCULAR, hasCondition: false },
      ]);

      expect(exclusionRepo.delete).toHaveBeenCalledWith({
        contractPersonId: mockContractPerson.id,
        source: ExclusionSource.AUTOMATIC,
      });
      expect(res).toEqual(existingManual);
      expect(exclusionRepo.save).not.toHaveBeenCalled();
    });

    it('should re-evaluate new declarations and save new automatic exclusions without colliding with manual ones', async () => {
      const existingManual = [
        {
          id: 'manual-1',
          contractPersonId: mockContractPerson.id,
          medicalServiceId: mockMedicalService1.id, // collides with mockMedicalService1
          reason: 'Manual previa para servicio 1',
          source: ExclusionSource.MANUAL,
        } as ContractPersonExclusion,
      ];

      exclusionRepo.find.mockResolvedValue(existingManual);
      // Evaluation suggests both service 1 and service 2
      medicalServicesService.findByHealthCategories.mockResolvedValue([
        mockMedicalService1,
        mockMedicalService2,
      ]);

      const res = await service.resyncAutomaticExclusions(mockContractPerson, [
        { category: HealthCategory.CARDIOVASCULAR, hasCondition: true },
      ]);

      expect(exclusionRepo.delete).toHaveBeenCalledWith({
        contractPersonId: mockContractPerson.id,
        source: ExclusionSource.AUTOMATIC,
      });

      // mockMedicalService1 should be skipped because it collides with existingManual
      // Only mockMedicalService2 should be created and saved
      expect(exclusionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contractPersonId: mockContractPerson.id,
          medicalServiceId: mockMedicalService2.id,
          source: ExclusionSource.AUTOMATIC,
        }),
      );
      expect(res).toHaveLength(2); // 1 manual + 1 new automatic
    });

    it('should work inside a manager transaction', async () => {
      const mockManagerRepo = {
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation((dto) => dto),
        save: jest.fn().mockImplementation(async (entities) => entities),
      };
      const mockManager = {
        getRepository: jest.fn().mockReturnValue(mockManagerRepo),
      } as unknown as EntityManager;

      await service.resyncAutomaticExclusions(mockContractPerson, [], mockManager);

      expect(mockManager.getRepository).toHaveBeenCalledWith(ContractPersonExclusion);
      expect(mockManagerRepo.delete).toHaveBeenCalledWith({
        contractPersonId: mockContractPerson.id,
        source: ExclusionSource.AUTOMATIC,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. findByContractPerson
  // ─────────────────────────────────────────────────────────────────────────────
  describe('findByContractPerson', () => {
    it('should query active exclusions with relations using default repo', async () => {
      const mockExclusions = [{ id: 'ex-1', contractPersonId: 'cp-1' } as ContractPersonExclusion];
      exclusionRepo.find.mockResolvedValue(mockExclusions);

      const res = await service.findByContractPerson('cp-1');

      expect(exclusionRepo.find).toHaveBeenCalledWith({
        where: { contractPersonId: 'cp-1' },
        relations: ['medicalService', 'serviceCategory'],
        order: { createdAt: 'ASC' },
      });
      expect(res).toEqual(mockExclusions);
    });

    it('should query using manager repository when manager is provided', async () => {
      const mockManagerRepo = {
        find: jest.fn().mockResolvedValue([]),
      };
      const mockManager = {
        getRepository: jest.fn().mockReturnValue(mockManagerRepo),
      } as unknown as EntityManager;

      await service.findByContractPerson('cp-1', mockManager);

      expect(mockManager.getRepository).toHaveBeenCalledWith(ContractPersonExclusion);
      expect(mockManagerRepo.find).toHaveBeenCalledWith({
        where: { contractPersonId: 'cp-1' },
        relations: ['medicalService', 'serviceCategory'],
        order: { createdAt: 'ASC' },
      });
    });
  });
});
