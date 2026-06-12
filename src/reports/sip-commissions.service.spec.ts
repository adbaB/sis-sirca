import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SipCommissionsService } from './sip-commissions.service';
import { PdfService } from '../pdf/services/pdf.service';

describe('SipCommissionsService', () => {
  let service: SipCommissionsService;
  let dataSource: DataSource;
  let pdfService: PdfService;

  const mockPortfolios = [{ code: 'APF' }, { code: 'GMP' }, { code: 'HER' }];

  const mockRawData = [
    // 1. Nuevos (within range: 2026-04-01 to 2026-04-30)
    {
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'APF',
      contract_code: 'SIR-002-100',
      affiliation_date: '2026-04-05',
      payment_date: '2026-04-10',
      due_date: '2026-04-15',
      affiliate_count: '2',
    },
    // 2. Cobranzas Nuevo Convenio (payment_date <= due_date, code is not initial)
    {
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'GMP',
      contract_code: 'SIR-002-100',
      affiliation_date: '2026-03-01',
      payment_date: '2026-04-10',
      due_date: '2026-04-15',
      affiliate_count: '3',
    },
    // 3. Cobranzas Convenio Inicial (payment_date <= due_date, code is SIR-002-010)
    {
      plan_name: 'PLAN B',
      plan_amount: '100.00',
      commission_amount: '10.00',
      portfolio_code: 'HER',
      contract_code: 'SIR-002-010',
      affiliation_date: '2026-03-01',
      payment_date: '2026-04-10',
      due_date: '2026-04-15',
      affiliate_count: '1',
    },
    // 4. Extemporaneos Nuevo Convenio (payment_date > due_date, code not initial)
    {
      plan_name: 'PLAN A',
      plan_amount: '50.00',
      commission_amount: '5.00',
      portfolio_code: 'APF',
      contract_code: 'SIR-002-100',
      affiliation_date: '2026-03-01',
      payment_date: '2026-04-20',
      due_date: '2026-04-15',
      affiliate_count: '5',
    },
    // 5. Extemporaneos Convenio Inicial (payment_date > due_date, code is SIR-002-010)
    {
      plan_name: 'PLAN B',
      plan_amount: '100.00',
      commission_amount: '10.00',
      portfolio_code: 'HER',
      contract_code: 'SIR-002-010',
      affiliation_date: '2026-03-01',
      payment_date: '2026-04-20',
      due_date: '2026-04-15',
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

      const result = await service.buildReportData('2026-04-01', '2026-04-30');

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

      // 2. Cobranzas Nuevo Convenio
      const cobranzasNuevo = result.sections[1];
      expect(cobranzasNuevo.title).toBe('COBRANZAS EJECUTADAS (SEGÚN NUEVO CONVENIO)');
      expect(cobranzasNuevo.rows).toHaveLength(1);
      expect(cobranzasNuevo.rows[0].totalAffiliates).toBe(3);
      expect(cobranzasNuevo.rows[0].totalCommission).toBe(15); // 5.00 * 3

      // 3. Cobranzas Convenio Inicial
      const cobranzasInicial = result.sections[2];
      expect(cobranzasInicial.title).toBe(
        'COBRANZAS EJECUTADAS: CONVENIO INICIAL DESDE 002-001 HASTA 002-060',
      );
      expect(cobranzasInicial.rows).toHaveLength(1);
      expect(cobranzasInicial.rows[0].totalAffiliates).toBe(1);
      expect(cobranzasInicial.rows[0].totalCommission).toBe(10); // 10.00 * 1

      // 4. Extemporaneos Nuevo Convenio
      const extNuevo = result.sections[3];
      expect(extNuevo.title).toBe('COBRANZAS EJECUTADA CON EXTEMPORANEIDAD (SEGÚN NUEVO CONVENIO)');
      expect(extNuevo.rows).toHaveLength(1);
      expect(extNuevo.rows[0].totalAffiliates).toBe(5);
      expect(extNuevo.rows[0].totalCommission).toBe(25); // 5.00 * 5

      // 5. Extemporaneos Convenio Inicial
      const extInicial = result.sections[4];
      expect(extInicial.title).toBe('COBRANZAS EJECUTADA CON EXTEMPORANEIDAD');
      expect(extInicial.rows).toHaveLength(1);
      expect(extInicial.rows[0].totalAffiliates).toBe(4);
      expect(extInicial.rows[0].totalCommission).toBe(40); // 10.00 * 4

      // Grand total: 10 + 15 + 10 + 25 + 40 = 100
      expect(result.grandTotalCommission).toBe(100);
    });
  });

  describe('generateExcel', () => {
    it('should generate an Excel sheet successfully', async () => {
      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockPortfolios)
        .mockResolvedValueOnce(mockRawData);

      const buffer = await service.generateExcel('2026-04-01', '2026-04-30');
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

      const buffer = await service.generatePdf('2026-04-01', '2026-04-30');

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
