import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ProjectionReportService } from './projection-report.service';
import { PdfService } from '../pdf/services/pdf.service';

describe('ProjectionReportService', () => {
  let service: ProjectionReportService;
  let dataSource: DataSource;
  let pdfService: PdfService;

  const mockAdvisor = [{ name: 'Carlos Asesor' }];

  const mockRawContracts = [
    {
      contract_code: 'SIR-001-001',
      affiliation_date: '2026-01-15',
      person_name: 'Juan Perez',
      type_identity_card: 'V',
      identity_card: '11111111',
      plan_name: 'PLAN CLASICO',
      plan_amount: '25.00',
      contract_total_amount: '75.00',
      portfolio_code: 'APF',
      advisor_name: 'Carlos Asesor',
    },
    {
      contract_code: 'SIR-001-001',
      affiliation_date: '2026-01-15',
      person_name: 'Maria Perez',
      type_identity_card: 'V',
      identity_card: '22222222',
      plan_name: 'PLAN GOLD',
      plan_amount: '50.00',
      contract_total_amount: '75.00',
      portfolio_code: 'APF',
      advisor_name: 'Carlos Asesor',
    },
    {
      contract_code: 'SIR-001-002',
      affiliation_date: '2026-02-10',
      person_name: 'Pedro Gomez',
      type_identity_card: 'E',
      identity_card: '33333333',
      plan_name: 'PLAN CLASICO',
      plan_amount: '25.00',
      contract_total_amount: '25.00',
      portfolio_code: 'GMP',
      advisor_name: 'Carlos Asesor',
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectionReportService,
        {
          provide: DataSource,
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: PdfService,
          useValue: {
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf-projection-mock')),
          },
        },
      ],
    }).compile();

    service = module.get<ProjectionReportService>(ProjectionReportService);
    dataSource = module.get<DataSource>(DataSource);
    pdfService = module.get<PdfService>(PdfService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildReportData', () => {
    it('should query and group active contracts correctly', async () => {
      const querySpy = jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockAdvisor) // advisor name query
        .mockResolvedValueOnce(mockRawContracts); // contracts query

      const result = await service.buildReportData('advisor-uuid');

      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(result.advisorName).toBe('Carlos Asesor');
      expect(result.sections).toHaveLength(2);

      // Section 1: APF
      const apfSection = result.sections[0];
      expect(apfSection.portfolioCode).toBe('APF');
      expect(apfSection.rows).toHaveLength(2);
      expect(apfSection.rows[0].contractCode).toBe('SIR-001-001');
      expect(apfSection.rows[0].contractTotalAmount).toBeNull();
      expect(apfSection.rows[0].contractTotalAmountFormatted).toBe('');
      expect(apfSection.rows[1].contractCode).toBe('SIR-001-001');
      expect(apfSection.rows[1].contractTotalAmount).toBe(75);
      expect(apfSection.rows[1].contractTotalAmountFormatted).toBe('75.00');
      expect(apfSection.subtotalCount).toBe(2);
      expect(apfSection.subtotalAmount).toBe(75);
      expect(apfSection.subtotalAmountFormatted).toBe('75.00');

      // Section 2: GMP
      const gmpSection = result.sections[1];
      expect(gmpSection.portfolioCode).toBe('GMP');
      expect(gmpSection.rows).toHaveLength(1);
      expect(gmpSection.rows[0].contractCode).toBe('SIR-001-002');
      expect(gmpSection.rows[0].contractTotalAmount).toBe(25);
      expect(gmpSection.rows[0].contractTotalAmountFormatted).toBe('25.00');
      expect(gmpSection.subtotalCount).toBe(1);
      expect(gmpSection.subtotalAmount).toBe(25);
      expect(gmpSection.subtotalAmountFormatted).toBe('25.00');

      // Grand Totals
      expect(result.grandTotalCount).toBe(3);
      expect(result.grandTotalAmount).toBe(100);
      expect(result.grandTotalAmountFormatted).toBe('100.00');
    });

    it('should query consolidated data when no advisorId is provided', async () => {
      const querySpy = jest.spyOn(dataSource, 'query').mockResolvedValueOnce(mockRawContracts);

      const result = await service.buildReportData();

      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(result.advisorName).toBe('Todos los Asesores');
    });

    it('should handle titular role correctly by setting plan amount to 0, not summing in total, and appending suffix to name', async () => {
      const mockRawWithTitular = [
        {
          contract_code: 'SIR-001-001',
          affiliation_date: '2026-01-15',
          person_name: 'Juan Perez (titular)',
          type_identity_card: 'V',
          identity_card: '11111111',
          plan_name: 'PLAN CLASICO',
          plan_amount: '0.00',
          contract_total_amount: '50.00',
          portfolio_code: 'APF',
          advisor_name: 'Carlos Asesor',
        },
        {
          contract_code: 'SIR-001-001',
          affiliation_date: '2026-01-15',
          person_name: 'Maria Perez',
          type_identity_card: 'V',
          identity_card: '22222222',
          plan_name: 'PLAN GOLD',
          plan_amount: '50.00',
          contract_total_amount: '50.00',
          portfolio_code: 'APF',
          advisor_name: 'Carlos Asesor',
        },
      ];

      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockAdvisor)
        .mockResolvedValueOnce(mockRawWithTitular);

      const result = await service.buildReportData('advisor-uuid');

      expect(result.sections).toHaveLength(1);
      const section = result.sections[0];
      expect(section.rows).toHaveLength(2);

      // Titular
      expect(section.rows[0].personName).toBe('Juan Perez (titular)');
      expect(section.rows[0].planAmount).toBe(0);
      expect(section.rows[0].contractTotalAmount).toBeNull();

      // Affiliate
      expect(section.rows[1].personName).toBe('Maria Perez');
      expect(section.rows[1].planAmount).toBe(50);
      expect(section.rows[1].contractTotalAmount).toBe(50); // should only sum affiliate(s)

      expect(section.subtotalAmount).toBe(50);
      expect(result.grandTotalAmount).toBe(50);
    });
  });

  describe('generateExcel', () => {
    it('should generate an Excel workbook successfully', async () => {
      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockAdvisor)
        .mockResolvedValueOnce(mockRawContracts);

      const buffer = await service.generateExcel('advisor-uuid');
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('generatePdf', () => {
    it('should render a landscape PDF successfully', async () => {
      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockAdvisor)
        .mockResolvedValueOnce(mockRawContracts);

      const buffer = await service.generatePdf('advisor-uuid');

      expect(pdfService.generatePdf).toHaveBeenCalledWith(
        'projection-report',
        expect.objectContaining({
          advisorName: 'Carlos Asesor',
          grandTotalCount: 3,
          grandTotalAmountFormatted: '100.00',
        }),
        { landscape: true },
      );
      expect(buffer.toString()).toBe('pdf-projection-mock');
    });
  });
});
