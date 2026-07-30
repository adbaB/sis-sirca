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
      line_id: 'l1',
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'APF',
      contract_code: 'SIR-002-100',
      legacy_code: null,
      billing_month: '2026-04',
      affiliation_date: '2026-04-05',
      payment_date: '2026-04-01',
      operation_date: '2026-03-28',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '2',
      advisor_name: 'Carlos Perez',
      advisor_code: '1',
      advisor_commission_percentage: '10.00',
      affiliate_id_type: 'V',
      affiliate_id_number: '12345678',
      affiliate_name: 'Juan Perez',
    },
    // 2. Cobranzas Nuevo Convenio (billing_month = '2026-04', NOT new, NOT convenio inicial)
    {
      line_id: 'l2',
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'GMP',
      contract_code: 'SIR-002-100',
      legacy_code: null,
      billing_month: '2026-04',
      affiliation_date: '2026-03-01',
      payment_date: '2026-03-28',
      operation_date: '2026-03-28',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '3',
      advisor_name: 'Carlos Perez',
      advisor_code: '1',
      advisor_commission_percentage: '10.00',
      affiliate_id_type: 'V',
      affiliate_id_number: '23456789',
      affiliate_name: 'Maria Gomez',
    },
    // 3. Cobranzas Convenio Inicial (billing_month = '2026-04', NOT new, IS convenio inicial)
    {
      line_id: 'l3',
      plan_name: 'PLAN B',
      plan_amount: '100.00',
      commission_amount: '10.00',
      portfolio_code: 'HER',
      contract_code: 'SIR-003-010',
      legacy_code: 'SIR-002-010',
      billing_month: '2026-04',
      affiliation_date: '2026-03-01',
      payment_date: '2026-04-02',
      operation_date: '2026-04-02',
      due_date: '2026-04-15',
      issue_date: '2026-04-01',
      affiliate_count: '1',
      advisor_name: 'Ana Lopez',
      advisor_code: '2',
      advisor_commission_percentage: '15.00',
      affiliate_id_type: 'V',
      affiliate_id_number: '34567890',
      affiliate_name: 'Pedro Rodriguez',
    },
    // 4. Extemporaneos Nuevo Convenio (billing_month = '2026-03' ≠ '2026-04', NOT convenio inicial)
    {
      line_id: 'l4',
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'APF',
      contract_code: 'SIR-002-100',
      legacy_code: null,
      billing_month: '2026-03',
      affiliation_date: '2026-02-01',
      payment_date: '2026-03-15',
      operation_date: '2026-03-15',
      due_date: '2026-03-15',
      issue_date: '2026-03-01',
      affiliate_count: '5',
      advisor_name: 'Carlos Perez',
      advisor_code: '1',
      advisor_commission_percentage: '10.00',
      affiliate_id_type: 'V',
      affiliate_id_number: '45678901',
      affiliate_name: 'Luis Fernandez',
    },
    // 5. Extemporaneos Convenio Inicial (billing_month = '2026-02' ≠ '2026-04', IS convenio inicial)
    {
      line_id: 'l5',
      plan_name: 'PLAN B',
      plan_amount: '100.00',
      commission_amount: '10.00',
      portfolio_code: 'HER',
      contract_code: 'SIR-003-010',
      legacy_code: 'SIR-002-010',
      billing_month: '2026-02',
      affiliation_date: '2026-01-01',
      payment_date: '2026-03-10',
      operation_date: '2026-03-10',
      due_date: '2026-02-15',
      issue_date: '2026-02-01',
      affiliate_count: '4',
      advisor_name: 'Ana Lopez',
      advisor_code: '2',
      advisor_commission_percentage: '15.00',
      affiliate_id_type: 'V',
      affiliate_id_number: '56789012',
      affiliate_name: 'Elena Sanchez',
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

      const secondCall = querySpy.mock.calls[1];
      expect(secondCall[1]).toEqual(['2026-03-06', '2026-04-05']);

      expect(result.portfolioCodes).toEqual(['APF', 'GMP', 'HER']);

      // Verify sections
      expect(result.sections).toHaveLength(5);

      // 1. Nuevos
      const nuevos = result.sections[0];
      expect(nuevos.title).toBe('AFILIACIONES NUEVOS CONTRATOS');
      expect(nuevos.rows).toHaveLength(1);
      expect(nuevos.rows[0].planName).toBe('PLAN A');
      expect(nuevos.rows[0].totalAffiliates).toBe(2);
      expect(nuevos.rows[0].totalCommission).toBe(10);
      expect(nuevos.affiliateDetails).toHaveLength(1);
      expect(nuevos.affiliateDetails[0].fullAdvisorName).toBe('001 - Carlos Perez');
      expect(nuevos.affiliateDetails[0].affiliateName).toBe('Juan Perez');
      expect(nuevos.affiliateDetails[0].advisorCommissionPercentage).toBe(10);
      expect(nuevos.affiliateDetails[0].advisorCommissionAmount).toBe(5); // 50.00 * 10%

      // 2. Cobranzas Nuevo Convenio
      const cobranzasNuevo = result.sections[1];
      expect(cobranzasNuevo.title).toBe('COBRANZAS EJECUTADAS (SEGÚN NUEVO CONVENIO)');
      expect(cobranzasNuevo.rows).toHaveLength(1);
      expect(cobranzasNuevo.rows[0].totalAffiliates).toBe(3);
      expect(cobranzasNuevo.rows[0].totalCommission).toBe(15);
      expect(cobranzasNuevo.affiliateDetails).toHaveLength(1);

      // 3. Cobranzas Convenio Inicial
      const cobranzasInicial = result.sections[2];
      expect(cobranzasInicial.title).toBe(
        'COBRANZAS EJECUTADAS: CONVENIO INICIAL DESDE 002-001 HASTA 002-060',
      );
      expect(cobranzasInicial.rows).toHaveLength(1);
      expect(cobranzasInicial.rows[0].totalAffiliates).toBe(1);
      expect(cobranzasInicial.rows[0].totalCommission).toBe(10);
      expect(cobranzasInicial.affiliateDetails).toHaveLength(1);
      expect(cobranzasInicial.affiliateDetails[0].advisorCommissionPercentage).toBe(15);
      expect(cobranzasInicial.affiliateDetails[0].advisorCommissionAmount).toBe(15); // 100.00 * 15%

      // 4. Extemporaneos Nuevo Convenio
      const extNuevo = result.sections[3];
      expect(extNuevo.title).toBe('COBRANZAS EJECUTADA CON EXTEMPORANEIDAD (SEGÚN NUEVO CONVENIO)');
      expect(extNuevo.rows).toHaveLength(1);
      expect(extNuevo.rows[0].totalAffiliates).toBe(5);
      expect(extNuevo.rows[0].totalCommission).toBe(25);
      expect(extNuevo.affiliateDetails).toHaveLength(1);

      // 5. Extemporaneos Convenio Inicial
      const extInicial = result.sections[4];
      expect(extInicial.title).toBe('COBRANZAS EJECUTADA CON EXTEMPORANEIDAD');
      expect(extInicial.rows).toHaveLength(1);
      expect(extInicial.rows[0].totalAffiliates).toBe(4);
      expect(extInicial.rows[0].totalCommission).toBe(40);
      expect(extInicial.affiliateDetails).toHaveLength(1);

      // Grand total: 10 + 15 + 10 + 25 + 40 = 100
      expect(result.grandTotalCommission).toBe(100);
    });

    it('should classify all billing_month mismatches as extemporaneidad', async () => {
      const oldMonthRecord = {
        line_id: 'lx',
        plan_name: 'PLAN C',
        plan_amount: '75.00',
        commission_amount: '7.50',
        portfolio_code: 'APF',
        contract_code: 'SIR-002-100',
        legacy_code: null,
        billing_month: '2026-01',
        affiliation_date: '2025-12-01',
        payment_date: '2026-03-20',
        operation_date: '2026-03-20',
        due_date: '2026-01-15',
        issue_date: '2026-01-01',
        affiliate_count: '2',
        advisor_name: 'Carlos Perez',
        advisor_code: '1',
        advisor_commission_percentage: '10.00',
        affiliate_id_type: 'V',
        affiliate_id_number: '99999999',
        affiliate_name: 'Prueba Extemporaneo',
      };

      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockPortfolios)
        .mockResolvedValueOnce([oldMonthRecord]);

      const result = await service.buildReportData(2026, 4);

      const extNuevo = result.sections[3];
      expect(extNuevo.rows).toHaveLength(1);
      expect(extNuevo.rows[0].totalAffiliates).toBe(2);
      expect(extNuevo.rows[0].totalCommission).toBe(15);
      expect(extNuevo.affiliateDetails).toHaveLength(1);
      expect(extNuevo.affiliateDetails[0].affiliateName).toBe('Prueba Extemporaneo');
      expect(extNuevo.affiliateDetails[0].advisorCommissionAmount).toBe(7.5); // 75.00 * 10%
    });
  });

  describe('generateExcel', () => {
    it('should generate an Excel workbook with 2 sheets successfully', async () => {
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
    it('should generate a PDF buffer successfully with affiliate details', async () => {
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
