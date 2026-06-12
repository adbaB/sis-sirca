import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AdvisorPaymentsService } from './advisor-payments.service';
import { PdfService } from '../pdf/services/pdf.service';

describe('AdvisorPaymentsService', () => {
  let service: AdvisorPaymentsService;
  let dataSource: DataSource;
  let pdfService: PdfService;

  const mockAdvisor = [{ name: 'Maria Asesora' }];

  const mockRawPayments = [
    {
      payment_id: 'pay-1',
      payment_date: '2026-04-10T14:30:00Z',
      reference_number: 'REF-12345',
      payment_method: 'PAGO_MOVIL',
      payment_amount: '100.00',
      payment_amount_bs: '3650.00',
      contract_code: 'SIR-002-100',
      invoice_status: 'PAID',
      portfolio_code: 'APF',
      surplus_amount: '10.00',
      surplus_amount_bs: '365.00',
      type_identity_card: 'V',
      identity_card: '12345678',
      titular_name: 'Juan Perez',
    },
    {
      payment_id: 'pay-2',
      payment_date: '2026-04-12T10:00:00Z',
      reference_number: 'REF-67890',
      payment_method: 'ZELLE',
      payment_amount: '200.00',
      payment_amount_bs: '0.00',
      contract_code: 'SIR-002-200',
      invoice_status: 'PARTIAL',
      portfolio_code: 'GMP',
      surplus_amount: '0.00',
      surplus_amount_bs: '0.00',
      type_identity_card: 'E',
      identity_card: '87654321',
      titular_name: 'Ana Gomez',
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdvisorPaymentsService,
        {
          provide: DataSource,
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: PdfService,
          useValue: {
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf-payments-mock')),
          },
        },
      ],
    }).compile();

    service = module.get<AdvisorPaymentsService>(AdvisorPaymentsService);
    dataSource = module.get<DataSource>(DataSource);
    pdfService = module.get<PdfService>(PdfService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildReportData', () => {
    it('should query and group records by portfolio correctly', async () => {
      const querySpy = jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockAdvisor) // first query for advisor name
        .mockResolvedValueOnce(mockRawPayments); // second query for payments

      const result = await service.buildReportData(2026, 4, 'advisor-uuid');

      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(result.advisorName).toBe('Maria Asesora');
      expect(result.billingMonthLabel).toBe('Abril 2026');
      expect(result.sections).toHaveLength(2);

      // Section 1: APF
      const apfSection = result.sections[0];
      expect(apfSection.portfolioCode).toBe('APF');
      expect(apfSection.payments).toHaveLength(1);
      expect(apfSection.payments[0].paymentAmount).toBe(100);
      expect(apfSection.payments[0].surplusAmount).toBe(10);
      expect(apfSection.payments[0].surplusAmountBs).toBe(365);
      expect(apfSection.subtotalUsd).toBe(100);
      expect(apfSection.subtotalBs).toBe(3650);
      expect(apfSection.subtotalSurplusBs).toBe(365);

      // Section 2: GMP
      const gmpSection = result.sections[1];
      expect(gmpSection.portfolioCode).toBe('GMP');
      expect(gmpSection.payments).toHaveLength(1);
      expect(gmpSection.payments[0].paymentAmount).toBe(200);
      expect(gmpSection.payments[0].surplusAmount).toBe(0);
      expect(gmpSection.payments[0].surplusAmountBs).toBe(0);
      expect(gmpSection.subtotalUsd).toBe(200);
      expect(gmpSection.subtotalBs).toBe(0);
      expect(gmpSection.subtotalSurplusBs).toBe(0);

      // Grand totals
      expect(result.grandTotalUsd).toBe(300);
      expect(result.grandTotalBs).toBe(3650);
      expect(result.grandTotalSurplus).toBe(10);
      expect(result.grandTotalSurplusBs).toBe(365);
    });

    it('should query and return consolidated data when no advisorId is provided', async () => {
      const querySpy = jest.spyOn(dataSource, 'query').mockResolvedValueOnce(mockRawPayments); // only payments query

      const result = await service.buildReportData(2026, 4);

      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(result.advisorName).toBe('Todos los Asesores');
    });
  });

  describe('generateExcel', () => {
    it('should generate an Excel workbook successfully', async () => {
      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockAdvisor)
        .mockResolvedValueOnce(mockRawPayments);

      const buffer = await service.generateExcel(2026, 4, 'advisor-uuid');
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('generatePdf', () => {
    it('should render a landscape PDF successfully', async () => {
      jest
        .spyOn(dataSource, 'query')
        .mockResolvedValueOnce(mockAdvisor)
        .mockResolvedValueOnce(mockRawPayments);

      const buffer = await service.generatePdf(2026, 4, 'advisor-uuid');

      expect(pdfService.generatePdf).toHaveBeenCalledWith(
        'advisor-payments',
        expect.objectContaining({
          advisorName: 'Maria Asesora',
          billingMonthLabel: 'Abril 2026',
          grandTotalUsdFormatted: '300.00',
          grandTotalSurplusBsFormatted: '365.00',
        }),
        { landscape: true },
      );
      expect(buffer.toString()).toBe('pdf-payments-mock');
    });
  });
});
