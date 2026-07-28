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
  // Query window: [2026-03-06, 2026-04-05]
  // Classification: billing_month = '2026-04' → Cobranza/Nuevos, billing_month ≠ '2026-04' → Extemporaneidad
  const mockRawData = [
    // 1. Nuevos (billing_month = '2026-04', affiliation within billing month)
    {
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'APF',
      contract_code: 'SIR-002-100',
      billing_month: '2026-04',
      affiliation_date: '2026-04-05',
      payment_date: '2026-04-01',
      operation_date: '2026-03-28',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '2',
    },
    // 2. Cobranzas Nuevo Convenio (billing_month = '2026-04', NOT new, NOT convenio inicial)
    {
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'GMP',
      contract_code: 'SIR-002-100',
      billing_month: '2026-04',
      affiliation_date: '2026-03-01',
      payment_date: '2026-03-28',
      operation_date: '2026-03-28',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '3',
    },
    // 3. Cobranzas Convenio Inicial (billing_month = '2026-04', NOT new, IS convenio inicial)
    {
      plan_name: 'PLAN B',
      plan_amount: '100.00',
      commission_amount: '10.00',
      portfolio_code: 'HER',
      contract_code: 'SIR-002-010',
      billing_month: '2026-04',
      affiliation_date: '2026-03-01',
      payment_date: '2026-04-02',
      operation_date: '2026-04-02',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '1',
    },
    // 4. Extemporaneos Nuevo Convenio (billing_month = '2026-03' ≠ '2026-04', NOT convenio inicial)
    {
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'APF',
      contract_code: 'SIR-002-100',
      billing_month: '2026-03',
      affiliation_date: '2026-02-01',
      payment_date: '2026-03-15',
      operation_date: '2026-03-15',
      due_date: '2026-03-15',
      issue_date: '2026-03-01',
      affiliate_count: '5',
    },
    // 5. Extemporaneos Convenio Inicial (billing_month = '2026-02' ≠ '2026-04', IS convenio inicial)
    {
      plan_name: 'PLAN B',
      plan_amount: '100.00',
      commission_amount: '10.00',
      portfolio_code: 'HER',
      contract_code: 'SIR-002-010',
      billing_month: '2026-02',
      affiliation_date: '2026-01-01',
      payment_date: '2026-03-10',
      operation_date: '2026-03-10',
      due_date: '2026-02-15',
      issue_date: '2026-02-01',
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
        .mockResolvedValueOnce(mockPortfolios) // first query: portfolios
        .mockResolvedValueOnce(mockRawData); // second query: invoice lines

      const result = await service.buildReportData(2026, 4);

      expect(querySpy).toHaveBeenCalledTimes(2);

      // Verify the SQL query uses date window params instead of billing_month
      const secondCall = querySpy.mock.calls[1];
      expect(secondCall[1]).toEqual(['2026-03-06', '2026-04-05']);

      expect(result.portfolioCodes).toEqual(['APF', 'GMP', 'HER']);

      // Verify sections
      expect(result.sections).toHaveLength(5);

      // 1. Nuevos (billing_month = '2026-04', affiliation in billing month)
      const nuevos = result.sections[0];
      expect(nuevos.title).toBe('AFILIACIONES NUEVOS CONTRATOS');
      expect(nuevos.rows).toHaveLength(1);
      expect(nuevos.rows[0].planName).toBe('PLAN A');
      expect(nuevos.rows[0].totalAffiliates).toBe(2);
      expect(nuevos.rows[0].totalCommission).toBe(10); // 5.00 * 2

      // 2. Cobranzas Nuevo Convenio (billing_month = '2026-04', not new, not convenio)
      const cobranzasNuevo = result.sections[1];
      expect(cobranzasNuevo.title).toBe('COBRANZAS EJECUTADAS (SEGÚN NUEVO CONVENIO)');
      expect(cobranzasNuevo.rows).toHaveLength(1);
      expect(cobranzasNuevo.rows[0].totalAffiliates).toBe(3);
      expect(cobranzasNuevo.rows[0].totalCommission).toBe(15); // 5.00 * 3

      // 3. Cobranzas Convenio Inicial (billing_month = '2026-04', not new, IS convenio)
      const cobranzasInicial = result.sections[2];
      expect(cobranzasInicial.title).toBe(
        'COBRANZAS EJECUTADAS: CONVENIO INICIAL DESDE 002-001 HASTA 002-060',
      );
      expect(cobranzasInicial.rows).toHaveLength(1);
      expect(cobranzasInicial.rows[0].totalAffiliates).toBe(1);
      expect(cobranzasInicial.rows[0].totalCommission).toBe(10); // 10.00 * 1

      // 4. Extemporaneos Nuevo Convenio (billing_month = '2026-03' ≠ '2026-04')
      const extNuevo = result.sections[3];
      expect(extNuevo.title).toBe('COBRANZAS EJECUTADA CON EXTEMPORANEIDAD (SEGÚN NUEVO CONVENIO)');
      expect(extNuevo.rows).toHaveLength(1);
      expect(extNuevo.rows[0].totalAffiliates).toBe(5);
      expect(extNuevo.rows[0].totalCommission).toBe(25); // 5.00 * 5

      // 5. Extemporaneos Convenio Inicial (billing_month = '2026-02' ≠ '2026-04')
      const extInicial = result.sections[4];
      expect(extInicial.title).toBe('COBRANZAS EJECUTADA CON EXTEMPORANEIDAD');
      expect(extInicial.rows).toHaveLength(1);
      expect(extInicial.rows[0].totalAffiliates).toBe(4);
      expect(extInicial.rows[0].totalCommission).toBe(40); // 10.00 * 4

      // Grand total: 10 + 15 + 10 + 25 + 40 = 100
      expect(result.grandTotalCommission).toBe(100);
    });

    it('should classify all billing_month mismatches as extemporaneidad', async () => {
      const oldMonthRecord = {
        plan_name: 'PLAN C',
        plan_amount: '75.00',
        commission_amount: '7.50',
        portfolio_code: 'APF',
        contract_code: 'SIR-002-100',
        billing_month: '2026-01', // Old billing month
        affiliation_date: '2025-12-01',
        payment_date: '2026-03-20',
        operation_date: '2026-03-20',
        due_date: '2026-01-15',
        issue_date: '2026-01-01',
        affiliate_count: '2',
      };

      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockPortfolios)
        .mockResolvedValueOnce([oldMonthRecord]);

      const result = await service.buildReportData(2026, 4);

      // Should be extemporaneidad (nuevo convenio, since contract code is not initial)
      const extNuevo = result.sections[3];
      expect(extNuevo.rows).toHaveLength(1);
      expect(extNuevo.rows[0].totalAffiliates).toBe(2);
      expect(extNuevo.rows[0].totalCommission).toBe(15); // 7.50 * 2

      // Cobranza sections should be empty
      expect(result.sections[0].rows).toHaveLength(0); // nuevos
      expect(result.sections[1].rows).toHaveLength(0); // cobranza nuevo
      expect(result.sections[2].rows).toHaveLength(0); // cobranza inicial
    });

    it('should classify billing_month match as cobranza ejecutada', async () => {
      const currentMonthRecord = {
        plan_name: 'PLAN D',
        plan_amount: '60.00',
        commission_amount: '6.00',
        portfolio_code: 'GMP',
        contract_code: 'SIR-002-100',
        billing_month: '2026-04', // Matches report month
        affiliation_date: '2026-02-01', // Not new
        payment_date: '2026-03-28',
        operation_date: '2026-03-28',
        due_date: '2026-04-15',
        issue_date: '2026-04-01',
        affiliate_count: '1',
      };

      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockPortfolios)
        .mockResolvedValueOnce([currentMonthRecord]);

      const result = await service.buildReportData(2026, 4);

      // Should be cobranza ejecutada (nuevo convenio)
      const cobranzasNuevo = result.sections[1];
      expect(cobranzasNuevo.rows).toHaveLength(1);
      expect(cobranzasNuevo.rows[0].totalAffiliates).toBe(1);

      // Extemporaneidad should be empty
      expect(result.sections[3].rows).toHaveLength(0);
      expect(result.sections[4].rows).toHaveLength(0);
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
