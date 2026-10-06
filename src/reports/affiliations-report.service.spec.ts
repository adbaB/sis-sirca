import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { AffiliationsReportService } from './affiliations-report.service';
import { AffiliationHistory } from '../contracts/entities/affiliation-history.entity';
import { AffiliationAction } from '../contracts/enums/affiliation-action.enum';
import { PdfService } from '../pdf/services/pdf.service';

describe('AffiliationsReportService', () => {
  let service: AffiliationsReportService;
  let historyRepo: Repository<AffiliationHistory>;
  let pdfService: PdfService;

  const mockHistories: Partial<AffiliationHistory>[] = [
    {
      id: 'h1',
      action: AffiliationAction.AFILIACION,
      actionDate: new Date('2026-02-10T12:00:00Z'),
      reason: null,
      contract: { code: 'SIR-2026-001' } as AffiliationHistory['contract'],
      person: {
        name: 'Juan Perez',
        typeIdentityCard: 'V',
        identityCard: '12345678',
      } as AffiliationHistory['person'],
      plan: { name: 'Plan Clásico' } as AffiliationHistory['plan'],
    },
    {
      id: 'h2',
      action: AffiliationAction.DESAFILIACION,
      actionDate: new Date('2026-02-15T15:30:00Z'),
      reason: 'Solicitud del titular',
      contract: { code: 'SIR-2026-002' } as AffiliationHistory['contract'],
      person: {
        name: 'Maria Lopez',
        typeIdentityCard: 'V',
        identityCard: '87654321',
      } as AffiliationHistory['person'],
      plan: { name: 'Plan Dorado' } as AffiliationHistory['plan'],
    },
  ];

  beforeEach(async () => {
    const queryBuilder = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue(mockHistories as AffiliationHistory[]),
    } as unknown as SelectQueryBuilder<AffiliationHistory>;

    const mockHistoryRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const mockPdfService = {
      generatePdf: vi.fn().mockResolvedValue(Buffer.from('pdf-content')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AffiliationsReportService,
        {
          provide: getRepositoryToken(AffiliationHistory),
          useValue: mockHistoryRepo,
        },
        {
          provide: PdfService,
          useValue: mockPdfService,
        },
      ],
    }).compile();

    service = module.get<AffiliationsReportService>(AffiliationsReportService);
    historyRepo = module.get<Repository<AffiliationHistory>>(
      getRepositoryToken(AffiliationHistory),
    );
    pdfService = module.get<PdfService>(PdfService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
    expect(historyRepo).toBeDefined();
    expect(pdfService).toBeDefined();
  });

  describe('Validación de fechas', () => {
    it('debe lanzar BadRequestException si falta startDate o endDate', async () => {
      await expect(service.getReportData('', '2026-02-28')).rejects.toThrow(BadRequestException);
      await expect(service.getReportData('2026-02-01', '')).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar BadRequestException si el formato de fecha es inválido', async () => {
      await expect(service.getReportData('invalido', '2026-02-28')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('debe lanzar BadRequestException si startDate es posterior a endDate', async () => {
      await expect(service.getReportData('2026-03-01', '2026-02-01')).rejects.toThrow(
        'La fecha inicial (startDate) no puede ser posterior a la fecha final (endDate).',
      );
    });
  });

  describe('getReportData', () => {
    it('debe clasificar correctamente afiliaciones y desafiliaciones', async () => {
      const result = await service.getReportData('2026-02-01', '2026-02-28');

      expect(result.totalAffiliations).toBe(1);
      expect(result.totalDisaffiliations).toBe(1);
      expect(result.affiliations[0].contractCode).toBe('SIR-2026-001');
      expect(result.affiliations[0].fullName).toBe('Juan Perez');
      expect(result.affiliations[0].identityCard).toBe('V-12345678');
      expect(result.affiliations[0].planName).toBe('Plan Clásico');

      expect(result.disaffiliations[0].contractCode).toBe('SIR-2026-002');
      expect(result.disaffiliations[0].fullName).toBe('Maria Lopez');
      expect(result.disaffiliations[0].reason).toBe('Solicitud del titular');
    });
  });

  describe('generateExcel', () => {
    it('debe generar un Buffer de Excel válido con ambas pestañas', async () => {
      const buffer = await service.generateExcel('2026-02-01', '2026-02-28');
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('generatePdf', () => {
    it('debe invocar a PdfService con la plantilla correcta y orientación landscape', async () => {
      const buffer = await service.generatePdf('2026-02-01', '2026-02-28');
      expect(buffer).toBeInstanceOf(Buffer);
      expect(pdfService.generatePdf).toHaveBeenCalledWith(
        'affiliations-report',
        expect.objectContaining({
          totalAffiliations: 1,
          totalDisaffiliations: 1,
          startDate: '2026-02-01',
          endDate: '2026-02-28',
        }),
        { landscape: true },
      );
    });
  });
});
