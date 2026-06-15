import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SipCommissionsService } from './sip-commissions.service';
import { AdvisorPaymentsService } from './advisor-payments.service';
import { ProjectionReportService } from './projection-report.service';

describe('ReportsController', () => {
  let controller: ReportsController;
  let reportsService: ReportsService;
  let sipCommissionsService: SipCommissionsService;
  let advisorPaymentsService: AdvisorPaymentsService;
  let projectionReportService: ProjectionReportService;

  const mockResponse = () => {
    const res: Partial<Response> = {};
    res.set = jest.fn().mockReturnValue(res);
    res.end = jest.fn().mockReturnValue(res);
    return res as Response;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        {
          provide: ReportsService,
          useValue: {
            generateExcel: jest.fn().mockResolvedValue(Buffer.from('excel')),
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
          },
        },
        {
          provide: SipCommissionsService,
          useValue: {
            generateExcel: jest.fn().mockResolvedValue(Buffer.from('sip-commissions-excel')),
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('sip-commissions-pdf')),
          },
        },
        {
          provide: AdvisorPaymentsService,
          useValue: {
            generateExcel: jest.fn().mockResolvedValue(Buffer.from('advisor-payments-excel')),
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('advisor-payments-pdf')),
          },
        },
        {
          provide: ProjectionReportService,
          useValue: {
            generateExcel: jest.fn().mockResolvedValue(Buffer.from('projection-excel')),
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('projection-pdf')),
          },
        },
      ],
    }).compile();

    controller = module.get<ReportsController>(ReportsController);
    reportsService = module.get<ReportsService>(ReportsService);
    sipCommissionsService = module.get<SipCommissionsService>(SipCommissionsService);
    advisorPaymentsService = module.get<AdvisorPaymentsService>(AdvisorPaymentsService);
    projectionReportService = module.get<ProjectionReportService>(ProjectionReportService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('downloadExcel', () => {
    it('should generate and return Excel file with headers', async () => {
      const res = mockResponse();
      await controller.downloadExcel(2026, 4, res);

      expect(reportsService.generateExcel).toHaveBeenCalledWith(2026, 4);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="reporte-contratos-2026-04.xlsx"',
        }),
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('excel'));
    });
  });

  describe('downloadPdf', () => {
    it('should generate and return PDF file with headers', async () => {
      const res = mockResponse();
      await controller.downloadPdf(2026, 4, res);

      expect(reportsService.generatePdf).toHaveBeenCalledWith(2026, 4);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="reporte-contratos-2026-04.pdf"',
        }),
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('pdf'));
    });
  });

  describe('downloadSipCommissionsExcel', () => {
    it('should generate and return SIP commissions Excel file with headers', async () => {
      const res = mockResponse();
      await controller.downloadSipCommissionsExcel(2026, 4, res);

      expect(sipCommissionsService.generateExcel).toHaveBeenCalledWith(2026, 4);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="comisiones-sip-2026-04.xlsx"',
        }),
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('sip-commissions-excel'));
    });
  });

  describe('downloadSipCommissionsPdf', () => {
    it('should generate and return SIP commissions PDF file with headers', async () => {
      const res = mockResponse();
      await controller.downloadSipCommissionsPdf(2026, 4, res);

      expect(sipCommissionsService.generatePdf).toHaveBeenCalledWith(2026, 4);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="comisiones-sip-2026-04.pdf"',
        }),
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('sip-commissions-pdf'));
    });
  });

  describe('downloadAdvisorPaymentsExcel', () => {
    it('should generate and return advisor payments Excel file with headers', async () => {
      const res = mockResponse();
      await controller.downloadAdvisorPaymentsExcel(2026, 4, 'advisor-uuid', res);

      expect(advisorPaymentsService.generateExcel).toHaveBeenCalledWith(2026, 4, 'advisor-uuid');
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="pagos-asesor-2026-04.xlsx"',
        }),
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('advisor-payments-excel'));
    });

    it('should throw BadRequestException if year or month are invalid', async () => {
      const res = mockResponse();
      await expect(
        controller.downloadAdvisorPaymentsExcel(NaN, 4, 'advisor-uuid', res),
      ).rejects.toThrow('Año o mes inválidos.');
      await expect(
        controller.downloadAdvisorPaymentsExcel(2026, 13, 'advisor-uuid', res),
      ).rejects.toThrow('Año o mes inválidos.');
    });
  });

  describe('downloadAdvisorPaymentsPdf', () => {
    it('should generate and return advisor payments PDF file with headers', async () => {
      const res = mockResponse();
      await controller.downloadAdvisorPaymentsPdf(2026, 4, 'advisor-uuid', res);

      expect(advisorPaymentsService.generatePdf).toHaveBeenCalledWith(2026, 4, 'advisor-uuid');
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="pagos-asesor-2026-04.pdf"',
        }),
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('advisor-payments-pdf'));
    });

    it('should throw BadRequestException if year or month are invalid', async () => {
      const res = mockResponse();
      await expect(
        controller.downloadAdvisorPaymentsPdf(NaN, 4, 'advisor-uuid', res),
      ).rejects.toThrow('Año o mes inválidos.');
      await expect(
        controller.downloadAdvisorPaymentsPdf(2026, 13, 'advisor-uuid', res),
      ).rejects.toThrow('Año o mes inválidos.');
    });
  });

  describe('downloadProjectionExcel', () => {
    it('should generate and return projection Excel file with headers', async () => {
      const res = mockResponse();
      await controller.downloadProjectionExcel('advisor-uuid', res);

      expect(projectionReportService.generateExcel).toHaveBeenCalledWith('advisor-uuid');
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="proyeccion-ingresos.xlsx"',
        }),
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('projection-excel'));
    });
  });

  describe('downloadProjectionPdf', () => {
    it('should generate and return projection PDF file with headers', async () => {
      const res = mockResponse();
      await controller.downloadProjectionPdf('advisor-uuid', res);

      expect(projectionReportService.generatePdf).toHaveBeenCalledWith('advisor-uuid');
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="proyeccion-ingresos.pdf"',
        }),
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('projection-pdf'));
    });
  });
});
