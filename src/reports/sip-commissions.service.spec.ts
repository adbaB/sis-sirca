import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SipCommissionsService } from './sip-commissions.service';
import { PdfService } from '../pdf/services/pdf.service';

describe('SipCommissionsService', () => {
  let service: SipCommissionsService;
  let dataSource: DataSource;
  let pdfService: PdfService;

  const mockPortfolios = [{ code: 'APF' }, { code: 'GMP' }, { code: 'HER' }];

  // Billing month: April 2026 (2026-04)
  // Cobranza ejecutada window:  [2026-03-25, 2026-04-05]
  // Extemporaneidad window:     [2026-03-06, 2026-03-24]
  const mockRawData = [
    // 1. Nuevos (affiliation_date within billing month: 2026-04-01 to 2026-04-30)
    {
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'APF',
      contract_code: 'SIR-002-100',
      affiliation_date: '2026-04-05',
      payment_date: '2026-04-01',
      operation_date: '2026-03-28',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '2',
    },
    // 2. Cobranzas Nuevo Convenio (operation_date 2026-03-28, within [03-25, 04-05], NOT convenio inicial)
    {
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'GMP',
      contract_code: 'SIR-002-100',
      affiliation_date: '2026-03-01',
      payment_date: '2026-03-28',
      operation_date: '2026-03-28',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '3',
    },
    // 3. Cobranzas Convenio Inicial (operation_date 2026-04-02, within [03-25, 04-05], IS convenio inicial)
    {
      plan_name: 'PLAN B',
      plan_amount: '100.00',
      commission_amount: '10.00',
      portfolio_code: 'HER',
      contract_code: 'SIR-002-010',
      affiliation_date: '2026-03-01',
      payment_date: '2026-04-02',
      operation_date: '2026-04-02',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '1',
    },
    // 4. Extemporaneos Nuevo Convenio (operation_date 2026-03-15, within [03-06, 03-24], NOT convenio inicial)
    {
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'APF',
      contract_code: 'SIR-002-100',
      affiliation_date: '2026-03-01',
      payment_date: '2026-03-15',
      operation_date: '2026-03-15',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '5',
    },
    // 5. Extemporaneos Convenio Inicial (operation_date 2026-03-10, within [03-06, 03-24], IS convenio inicial)
    {
      plan_name: 'PLAN B',
      plan_amount: '100.00',
      commission_amount: '10.00',
      portfolio_code: 'HER',
      contract_code: 'SIR-002-010',
      affiliation_date: '2026-03-01',
      payment_date: '2026-03-10',
      operation_date: '2026-03-10',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '4',
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SipCommissionsService,
        {
          provide: DataSource,
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: PdfService,
          useValue: {
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf-commissions-mock')),
          },
        },
      ],
    }).compile();

    service = module.get<SipCommissionsService>(SipCommissionsService);
    dataSource = module.get<DataSource>(DataSource);
    pdfService = module.get<PdfService>(PdfService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildReportData', () => {
    it('should query and classify records correctly into 5 sections', async () => {
      const querySpy = jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockPortfolios) // first query
        .mockResolvedValueOnce(mockRawData); // second query

      const result = await service.buildReportData(2026, 4);

      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(result.portfolioCodes).toEqual(['APF', 'GMP', 'HER']);

      // Verify sections
      expect(result.sections).toHaveLength(5);

      // 1. Nuevos
      const nuevos = result.sections[0];
      expect(nuevos.title).toBe('AFILIACIONES NUEVOS CONTRATOS');
      expect(nuevos.rows).toHaveLength(1);
      expect(nuevos.rows[0].planName).toBe('PLAN A');
      expect(nuevos.rows[0].totalAffiliates).toBe(2);
      expect(nuevos.rows[0].totalCommission).toBe(10); // 5.00 * 2
      expect(nuevos.subtotalAffiliates).toBe(2);
      expect(nuevos.subtotalCommission).toBe(10);

      // 2. Cobranzas Nuevo Convenio (operation_date 2026-03-28 in [03-25, 04-05])
      const cobranzasNuevo = result.sections[1];
      expect(cobranzasNuevo.title).toBe('COBRANZAS EJECUTADAS (SEGÚN NUEVO CONVENIO)');
      expect(cobranzasNuevo.rows).toHaveLength(1);
      expect(cobranzasNuevo.rows[0].totalAffiliates).toBe(3);
      expect(cobranzasNuevo.rows[0].totalCommission).toBe(15); // 5.00 * 3

      // 3. Cobranzas Convenio Inicial (operation_date 2026-04-02 in [03-25, 04-05])
      const cobranzasInicial = result.sections[2];
      expect(cobranzasInicial.title).toBe(
        'COBRANZAS EJECUTADAS: CONVENIO INICIAL DESDE 002-001 HASTA 002-060',
      );
      expect(cobranzasInicial.rows).toHaveLength(1);
      expect(cobranzasInicial.rows[0].totalAffiliates).toBe(1);
      expect(cobranzasInicial.rows[0].totalCommission).toBe(10); // 10.00 * 1

      // 4. Extemporaneos Nuevo Convenio (operation_date 2026-03-15 in [03-06, 03-24])
      const extNuevo = result.sections[3];
      expect(extNuevo.title).toBe('COBRANZAS EJECUTADA CON EXTEMPORANEIDAD (SEGÚN NUEVO CONVENIO)');
      expect(extNuevo.rows).toHaveLength(1);
      expect(extNuevo.rows[0].totalAffiliates).toBe(5);
      expect(extNuevo.rows[0].totalCommission).toBe(25); // 5.00 * 5

      // 5. Extemporaneos Convenio Inicial (operation_date 2026-03-10 in [03-06, 03-24])
      const extInicial = result.sections[4];
      expect(extInicial.title).toBe('COBRANZAS EJECUTADA CON EXTEMPORANEIDAD');
      expect(extInicial.rows).toHaveLength(1);
      expect(extInicial.rows[0].totalAffiliates).toBe(4);
      expect(extInicial.rows[0].totalCommission).toBe(40); // 10.00 * 4

      // Grand total: 10 + 15 + 10 + 25 + 40 = 100
      expect(result.grandTotalCommission).toBe(100);
    });

    it('should exclude records outside both date windows', async () => {
      const outOfRangeRecord = {
        plan_name: 'PLAN C',
        plan_amount: '75.00',
        commission_amount: '7.50',
        portfolio_code: 'APF',
        contract_code: 'SIR-002-100',
        affiliation_date: '2026-02-01',
        payment_date: '2026-03-01',
        operation_date: '2026-03-01', // Before extemporaneidad window [03-06, 03-24]
        due_date: '2026-04-15',
        issue_date: '2026-04-01',
        affiliate_count: '2',
      };

      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockPortfolios)
        .mockResolvedValueOnce([outOfRangeRecord]);

      const result = await service.buildReportData(2026, 4);

      // All sections should be empty (except the record should not be classified)
      const totalRows = result.sections.reduce((sum, s) => sum + s.rows.length, 0);
      expect(totalRows).toBe(0);
      expect(result.grandTotalCommission).toBe(0);
    });

    it('should classify boundary date 25th as cobranza ejecutada', async () => {
      const boundaryRecord = {
        plan_name: 'PLAN D',
        plan_amount: '60.00',
        commission_amount: '6.00',
        portfolio_code: 'GMP',
        contract_code: 'SIR-002-100',
        affiliation_date: '2026-02-01',
        payment_date: '2026-03-25',
        operation_date: '2026-03-25', // Exactly on the 25th — should be cobranza ejecutada
        due_date: '2026-04-15',
        issue_date: '2026-04-01',
        affiliate_count: '1',
      };

      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockPortfolios)
        .mockResolvedValueOnce([boundaryRecord]);

      const result = await service.buildReportData(2026, 4);

      // Should be in "Cobranzas Nuevo Convenio" (not extemporaneidad)
      const cobranzasNuevo = result.sections[1];
      expect(cobranzasNuevo.rows).toHaveLength(1);
      expect(cobranzasNuevo.rows[0].totalAffiliates).toBe(1);

      // Extemporaneidad should be empty
      const extNuevo = result.sections[3];
      expect(extNuevo.rows).toHaveLength(0);
    });
  });

  describe('generateExcel', () => {
    it('should generate an Excel sheet successfully', async () => {
      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockPortfolios)
        .mockResolvedValueOnce(mockRawData);

      const buffer = await service.generateExcel(2026, 4);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('generatePdf', () => {
    it('should generate a PDF buffer successfully', async () => {
      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockPortfolios)
        .mockResolvedValueOnce(mockRawData);

      const buffer = await service.generatePdf(2026, 4);

      expect(pdfService.generatePdf).toHaveBeenCalledWith(
        'sip-commissions',
        expect.objectContaining({
          startDateES: '01-04-2026',
          endDateES: '30-04-2026',
          colspan: 7,
          grandTotalCommissionFormatted: '100.00',
        }),
        { landscape: true },
      );
      expect(buffer.toString()).toBe('pdf-commissions-mock');
    });
  });
});
