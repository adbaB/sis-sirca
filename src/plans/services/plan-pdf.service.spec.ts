import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PdfService } from '../../pdf/services/pdf.service';
import { MedicalService } from '../entities/medical-service.entity';
import { PlanService, PlanServiceLimitType } from '../entities/plan-service.entity';
import { Plan, PlanStatus } from '../entities/plan.entity';
import { ServiceCategory } from '../entities/service-category.entity';
import { PlanPdfService, PlanPdfTemplateData } from './plan-pdf.service';

describe('PlanPdfService', () => {
  let service: PlanPdfService;
  let plansRepo: jest.Mocked<Repository<Plan>>;
  let planServicesRepo: jest.Mocked<Repository<PlanService>>;
  let pdfService: jest.Mocked<PdfService>;

  const mockPlan: Plan = {
    id: 'plan-uuid-1',
    name: 'Plan Familiar Dorado',
    amount: 25.5,
    coverage: 25000,
    minAge: 0,
    maxAge: 65,
    minMonths: 3,
    commissionAmount: 5,
    status: PlanStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    persons: [],
  };

  const mockCategoryA: ServiceCategory = {
    id: 'cat-1',
    code: 'CAT-CONS',
    name: 'Consultas Médicas',
    description: 'Consultas generales y especializadas',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockCategoryB: ServiceCategory = {
    id: 'cat-2',
    code: 'CAT-EMERG',
    name: 'Atención de Emergencias',
    description: 'Servicios de emergencia 24h',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockPlanServices: PlanService[] = [
    {
      id: 'ps-1',
      planId: 'plan-uuid-1',
      plan: mockPlan,
      medicalServiceId: 'ms-1',
      medicalService: {
        id: 'ms-1',
        code: 'MED-01',
        name: 'Medicina General',
        description: 'Consulta ambulatoria',
        categoryId: 'cat-1',
        category: mockCategoryA,
        linkedHealthCategories: [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as MedicalService,
      limitType: PlanServiceLimitType.UNLIMITED,
      limitQuantity: null,
      waitingPeriodDays: 0,
      copayAmount: 0,
      copayPercentage: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    {
      id: 'ps-2',
      planId: 'plan-uuid-1',
      plan: mockPlan,
      medicalServiceId: 'ms-2',
      medicalService: {
        id: 'ms-2',
        code: 'MED-02',
        name: 'Ginecología',
        description: null,
        categoryId: 'cat-1',
        category: mockCategoryA,
        linkedHealthCategories: [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as MedicalService,
      limitType: PlanServiceLimitType.UNLIMITED,
      limitQuantity: null,
      waitingPeriodDays: 30,
      copayAmount: 0,
      copayPercentage: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    {
      id: 'ps-3',
      planId: 'plan-uuid-1',
      plan: mockPlan,
      medicalServiceId: 'ms-3',
      medicalService: {
        id: 'ms-3',
        code: 'EMG-01',
        name: 'Emergencia Ambulatoria',
        description: null,
        categoryId: 'cat-2',
        category: mockCategoryB,
        linkedHealthCategories: [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as MedicalService,
      limitType: PlanServiceLimitType.UNLIMITED,
      limitQuantity: null,
      waitingPeriodDays: 0,
      copayAmount: 0,
      copayPercentage: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
  ];

  beforeEach(async () => {
    const mockPlansRepo = {
      findOne: jest.fn(),
    };

    const mockPlanServicesRepo = {
      find: jest.fn(),
    };

    const mockPdfService = {
      generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf-mock-buffer')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanPdfService,
        {
          provide: getRepositoryToken(Plan),
          useValue: mockPlansRepo,
        },
        {
          provide: getRepositoryToken(PlanService),
          useValue: mockPlanServicesRepo,
        },
        {
          provide: PdfService,
          useValue: mockPdfService,
        },
      ],
    }).compile();

    service = module.get<PlanPdfService>(PlanPdfService);
    plansRepo = module.get(getRepositoryToken(Plan));
    planServicesRepo = module.get(getRepositoryToken(PlanService));
    pdfService = module.get(PdfService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generatePlanPdf', () => {
    it('should throw NotFoundException if plan does not exist', async () => {
      plansRepo.findOne.mockResolvedValue(null);

      await expect(service.generatePlanPdf('non-existent-id')).rejects.toThrow(NotFoundException);
    });

    it('should generate PDF successfully with landscape option and category grouping', async () => {
      plansRepo.findOne.mockResolvedValue(mockPlan);
      planServicesRepo.find.mockResolvedValue(mockPlanServices);

      const result = await service.generatePlanPdf('plan-uuid-1');

      expect(result).toBeDefined();
      expect(result.filename).toBe('plan-plan-familiar-dorado.pdf');
      expect(result.pdfBuffer).toEqual(Buffer.from('pdf-mock-buffer'));

      expect(pdfService.generatePdf).toHaveBeenCalledTimes(1);
      const [templateName, rawData, options] = pdfService.generatePdf.mock.calls[0];
      const templateData = rawData as PlanPdfTemplateData;

      expect(templateName).toBe('plan-details');
      expect(options).toEqual({ landscape: true });

      expect(templateData.planName).toBe('Plan Familiar Dorado');
      expect(templateData.monthlyAmount).toBe('$25.50');
      expect(templateData.coverage).toBe('$25,000.00');
      expect(templateData.ageRange).toBe('Desde 3 meses hasta 65 años');
      expect(templateData.statusText).toBe('Activo');
      expect(templateData.totalServices).toBe(3);

      // Verify category grouping (Atención de Emergencias before Consultas Médicas)
      expect(templateData.categoryGroups).toHaveLength(2);

      const emergGroup = templateData.categoryGroups[0];
      expect(emergGroup.categoryName).toBe('Atención de Emergencias');
      expect(emergGroup.servicesCount).toBe(1);
      expect(emergGroup.pairedRows).toHaveLength(1);
      expect(emergGroup.pairedRows[0].left.serviceName).toBe('Emergencia Ambulatoria');
      expect(emergGroup.pairedRows[0].left.isImmediate).toBe(true);
      expect(emergGroup.pairedRows[0].left.waitingPeriodText).toBe('Inmediato');
      expect(emergGroup.pairedRows[0].right).toBeNull();

      const consultGroup = templateData.categoryGroups[1];
      expect(consultGroup.categoryName).toBe('Consultas Médicas');
      expect(consultGroup.servicesCount).toBe(2);
      expect(consultGroup.pairedRows).toHaveLength(1);
      expect(consultGroup.pairedRows[0].left.serviceName).toBe('Ginecología');
      expect(consultGroup.pairedRows[0].left.waitingPeriodText).toBe('30 días');
      expect(consultGroup.pairedRows[0].right?.serviceName).toBe('Medicina General');
      expect(consultGroup.pairedRows[0].right?.waitingPeriodText).toBe('Inmediato');
    });

    it('should handle plan with no services', async () => {
      plansRepo.findOne.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.INACTIVE,
      });
      planServicesRepo.find.mockResolvedValue([]);

      const result = await service.generatePlanPdf('plan-uuid-1');

      expect(result.filename).toBe('plan-plan-familiar-dorado.pdf');
      expect(pdfService.generatePdf).toHaveBeenCalledTimes(1);
      const [, rawData] = pdfService.generatePdf.mock.calls[0];
      const templateData = rawData as PlanPdfTemplateData;
      expect(templateData.statusText).toBe('Inactivo');
      expect(templateData.totalServices).toBe(0);
      expect(templateData.categoryGroups).toHaveLength(0);
    });
  });
});
