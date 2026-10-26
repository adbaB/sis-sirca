import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { EventualitiesController } from './eventualities.controller';
import { EventualitiesService } from '../services/eventualities.service';
import { EventualityPdfService } from '../services/eventuality-pdf.service';
import { EventualityStatisticsService } from '../services/eventuality-statistics.service';
import { EventualityStatus, EventualityType } from '../entities/eventuality.entity';

describe('EventualitiesController', () => {
  let controller: EventualitiesController;
  let service: {
    createEmergency: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    uploadMedicalReport: ReturnType<typeof vi.fn>;
    getMedicalReport: ReturnType<typeof vi.fn>;
    updateMedicalReportData: ReturnType<typeof vi.fn>;
    processConsumptionFile: ReturnType<typeof vi.fn>;
    getExtractionDetails: ReturnType<typeof vi.fn>;
    updateExtractionDetails: ReturnType<typeof vi.fn>;
    recalculateConsumptionByDate: ReturnType<typeof vi.fn>;
    addProviderInvoice: ReturnType<typeof vi.fn>;
    finalizeEmergency: ReturnType<typeof vi.fn>;
    getConsumptionAlertConfig: ReturnType<typeof vi.fn>;
    updateConsumptionAlertConfig: ReturnType<typeof vi.fn>;
    approveEmergency: ReturnType<typeof vi.fn>;
    rejectEmergency: ReturnType<typeof vi.fn>;
  };
  let pdfService: {
    generateVoucherPdf: ReturnType<typeof vi.fn>;
  };
  let statsService: {
    getDailyCreatedStats: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      createEmergency: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      uploadMedicalReport: vi.fn(),
      getMedicalReport: vi.fn(),
      updateMedicalReportData: vi.fn(),
      processConsumptionFile: vi.fn(),
      getExtractionDetails: vi.fn(),
      updateExtractionDetails: vi.fn(),
      recalculateConsumptionByDate: vi.fn(),
      addProviderInvoice: vi.fn(),
      finalizeEmergency: vi.fn(),
      getConsumptionAlertConfig: vi.fn(),
      updateConsumptionAlertConfig: vi.fn(),
      approveEmergency: vi.fn(),
      rejectEmergency: vi.fn(),
    };
    pdfService = {
      generateVoucherPdf: vi.fn(),
    };
    statsService = {
      getDailyCreatedStats: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventualitiesController],
      providers: [
        {
          provide: EventualitiesService,
          useValue: service,
        },
        {
          provide: EventualityPdfService,
          useValue: pdfService,
        },
        {
          provide: EventualityStatisticsService,
          useValue: statsService,
        },
      ],
    }).compile();

    controller = module.get<EventualitiesController>(EventualitiesController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('settings/consumption-alert', () => {
    it('should get consumption alert configuration', async () => {
      const mockConfig = {
        consumptionThresholdPercentage: 80,
        notificationPhones: ['584141234567'],
        enabled: true,
      };
      service.getConsumptionAlertConfig.mockResolvedValueOnce(mockConfig);

      const result = await controller.getConsumptionAlertConfig();
      expect(result).toEqual(mockConfig);
      expect(service.getConsumptionAlertConfig).toHaveBeenCalledTimes(1);
    });

    it('should update consumption alert configuration', async () => {
      const dto = {
        consumptionThresholdPercentage: 85,
        notificationPhones: ['584149998877'],
        enabled: true,
      };
      service.updateConsumptionAlertConfig.mockResolvedValueOnce(dto);

      const result = await controller.updateConsumptionAlertConfig(dto);
      expect(result).toEqual(dto);
      expect(service.updateConsumptionAlertConfig).toHaveBeenCalledWith(dto);
    });
  });

  describe('emergency approval and rejection', () => {
    it('should approve an emergency', async () => {
      const mockApproved = {
        id: 'ev-1',
        status: EventualityStatus.CLINIC_PROCESS,
        claimNumber: '2026000001',
      };
      service.approveEmergency.mockResolvedValueOnce(mockApproved);

      const result = await controller.approveEmergency('ev-1', {
        userId: 'admin-1',
        roleId: 'role-1',
      });
      expect(result).toEqual(mockApproved);
      expect(service.approveEmergency).toHaveBeenCalledWith('ev-1', {
        userId: 'admin-1',
        roleId: 'role-1',
      });
    });

    it('should reject an emergency', async () => {
      const mockRejected = {
        id: 'ev-2',
        status: EventualityStatus.REJECTED,
      };
      service.rejectEmergency.mockResolvedValueOnce(mockRejected);

      const result = await controller.rejectEmergency(
        'ev-2',
        { reason: 'Excede límite no renovable' },
        { userId: 'admin-1', roleId: 'role-1' },
      );
      expect(result).toEqual(mockRejected);
      expect(service.rejectEmergency).toHaveBeenCalledWith(
        'ev-2',
        { reason: 'Excede límite no renovable' },
        { userId: 'admin-1', roleId: 'role-1' },
      );
    });
  });

  describe('createEmergency', () => {
    it('should delegate createEmergency to service', async () => {
      const dto = {
        personId: 'person-1',
        contractPersonId: 'cp-1',
        clinicName: 'Clínica Caracas',
      };
      const mockCreated = {
        id: 'ev-3',
        type: EventualityType.EMERGENCY,
        status: EventualityStatus.CLINIC_PROCESS,
      };
      service.createEmergency.mockResolvedValueOnce(mockCreated);

      const result = await controller.createEmergency(dto);
      expect(result).toEqual(mockCreated);
      expect(service.createEmergency).toHaveBeenCalledWith(dto);
    });
  });

  describe('downloadVoucherPdf', () => {
    it('should stream PDF buffer with inline disposition and correct headers', async () => {
      const mockBuffer = Buffer.from('%PDF-1.4 test');
      pdfService.generateVoucherPdf.mockResolvedValueOnce({
        pdfBuffer: mockBuffer,
        filename: 'comprobante-eventualidad-20261015001.pdf',
      });

      const res = {
        set: vi.fn(),
        end: vi.fn(),
      } as unknown as Response;

      await controller.downloadVoucherPdf('20261015001', res);

      expect(pdfService.generateVoucherPdf).toHaveBeenCalledWith('20261015001');
      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="comprobante-eventualidad-20261015001.pdf"',
        'Content-Length': mockBuffer.length,
      });
      expect(res.end).toHaveBeenCalledWith(mockBuffer);
    });
  });

  describe('getDailyStats', () => {
    it('should delegate getDailyStats to eventualityStatisticsService', async () => {
      const mockResult = {
        period: {
          startDate: '2026-09-25',
          endDate: '2026-10-24',
          month: 10,
          year: 2026,
          monthLabel: 'Octubre 2026',
        },
        totalCount: 5,
        dailyAverage: 0.2,
        peakDay: { date: '2026-10-01', label: '1 oct', count: 3 },
        days: [],
      };
      statsService.getDailyCreatedStats.mockResolvedValueOnce(mockResult);

      const result = await controller.getDailyStats({ month: 10, year: 2026 });
      expect(result).toEqual(mockResult);
      expect(statsService.getDailyCreatedStats).toHaveBeenCalledWith(10, 2026);
    });
  });

  describe('medical-report endpoints', () => {
    it('should delegate getMedicalReport to service', async () => {
      const mockReport = {
        id: 'emr-1',
        eventualityId: 'ev-1',
        status: 'EXTRACTED',
        doctorFullName: 'Dr. Juan Pérez',
      };
      service.getMedicalReport.mockResolvedValueOnce(mockReport);

      const result = await controller.getMedicalReport('ev-1');
      expect(result).toEqual(mockReport);
      expect(service.getMedicalReport).toHaveBeenCalledWith('ev-1');
    });

    it('should delegate updateMedicalReportData to service', async () => {
      const dto = {
        doctorComezu: '54321',
        dischargeDiagnosis: 'Alta médica',
      };
      const mockUpdated = {
        id: 'emr-1',
        eventualityId: 'ev-1',
        status: 'EDITED',
        ...dto,
      };
      service.updateMedicalReportData.mockResolvedValueOnce(mockUpdated);

      const result = await controller.updateMedicalReportData('ev-1', dto);
      expect(result).toEqual(mockUpdated);
      expect(service.updateMedicalReportData).toHaveBeenCalledWith('ev-1', dto);
    });
  });

  describe('recalculateConsumptionByDate', () => {
    it('should delegate recalculateConsumptionByDate to service', async () => {
      const dto = { exchangeRateDate: '2026-10-21' };
      const mockRecalculated = {
        items: [],
        totals: {
          detectedCurrency: 'Bs',
          exchangeRateDate: '2026-10-21',
          appliedExchangeRate: 52.5,
          totalCosto: 30,
        },
      };
      service.recalculateConsumptionByDate.mockResolvedValueOnce(mockRecalculated);

      const result = await controller.recalculateConsumptionByDate('ev-1', dto);
      expect(result).toEqual(mockRecalculated);
      expect(service.recalculateConsumptionByDate).toHaveBeenCalledWith('ev-1', '2026-10-21');
    });
  });
});
