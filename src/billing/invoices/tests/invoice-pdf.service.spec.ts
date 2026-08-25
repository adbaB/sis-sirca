import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InvoicePdfService } from '../services/invoice-pdf.service';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { PdfService } from '../../../pdf/services/pdf.service';
import { Payment, PaymentOrigin, PaymentStatus } from '../../payments/entities/payment.entity';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';
import { formatDateES, getCaracasNow } from '../../../common/utils/date.util';
import { Contract } from '../../../contracts/entities/contract.entity';
import { ContractPerson } from '../../../contracts/entities/contract-person.entity';
import { Person, TypeIdentityCard } from '../../../persons/entities/person.entity';
import { InvoiceLine } from '../entities/invoice-line.entity';
import { Plan } from '../../../plans/entities/plan.entity';
import { Advisor } from '../../../advisors/entities/advisor.entity';

describe('InvoicePdfService', () => {
  let service: InvoicePdfService;
  let invoiceRepo: jest.Mocked<Repository<Invoice>>;
  let pdfService: jest.Mocked<PdfService>;

  beforeEach(async () => {
    const mockInvoiceRepo = {
      findOne: jest.fn(),
    };

    const mockPdfService = {
      generatePdf: jest.fn().mockResolvedValue(Buffer.from('dummy-pdf')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicePdfService,
        {
          provide: getRepositoryToken(Invoice),
          useValue: mockInvoiceRepo,
        },
        {
          provide: PdfService,
          useValue: mockPdfService,
        },
      ],
    }).compile();

    service = module.get<InvoicePdfService>(InvoicePdfService);
    invoiceRepo = module.get(getRepositoryToken(Invoice));
    pdfService = module.get(PdfService);
  });

  it('should throw NotFoundException if invoice does not exist', async () => {
    invoiceRepo.findOne.mockResolvedValue(null);

    await expect(service.buildInvoicePdf('non-existent-id')).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException if invoice has no associated contract', async () => {
    invoiceRepo.findOne.mockResolvedValue({
      id: 'inv-1',
      contract: null,
    } as unknown as Invoice);

    await expect(service.buildInvoicePdf('inv-1')).rejects.toThrow(NotFoundException);
  });

  it('should format paymentDate correctly for completed payments', async () => {
    const paymentDate = new Date('2026-07-22T10:00:00Z');
    const formattedPaymentDate = formatDateES(paymentDate, 'dd/MM/yyyy');
    const today = formatDateES(getCaracasNow(), 'dd/MM/yyyy');

    const person: Partial<Person> = {
      id: 'per-1',
      name: 'Juan Perez',
      typeIdentityCard: TypeIdentityCard.V,
      identityCard: '12345678',
    };

    const contractPerson: Partial<ContractPerson> = {
      isBillingOwner: true,
      person: person as Person,
    };

    const advisor: Partial<Advisor> = {
      name: 'John Advisor',
    };

    const contract: Partial<Contract> = {
      id: 'contract-1',
      code: 'CTR-001',
      legacyCode: 'LEG-001',
      advisor: advisor as Advisor,
      contractPersons: [contractPerson as ContractPerson],
    };

    const plan: Partial<Plan> = {
      name: 'Plan Oro',
    };

    const line: Partial<InvoiceLine> = {
      category: InvoiceLineCategory.MENSUALIDAD,
      description: 'Mensualidad Plan Oro',
      amount: 100,
      quantity: 1,
      person: person as Person,
      plan: plan as Plan,
    };

    const payment: Partial<Payment> = {
      id: 'pay-1',
      status: PaymentStatus.COMPLETED,
      paymentDate,
      paymentMethod: 'PAGO_MOVIL',
      referenceNumber: 'REF123456',
      amount: 100,
      amountBs: 4000,
      origin: PaymentOrigin.WEB,
    };

    const mockInvoice: Partial<Invoice> = {
      id: 'inv-1',
      billingMonth: '2026-07',
      totalAmount: 100,
      paidAmount: 100,
      retentionAmount: 0,
      retentionPercentage: 0,
      status: InvoiceStatus.PAID,
      contract: contract as Contract,
      lines: [line as InvoiceLine],
      payments: [payment as Payment],
    };

    invoiceRepo.findOne.mockResolvedValue(mockInvoice as Invoice);

    const result = await service.buildInvoicePdf('inv-1');

    expect(result.filename).toBe('factura-CTR-001-2026-07.pdf');
    expect(pdfService.generatePdf).toHaveBeenCalledWith(
      'invoice',
      expect.objectContaining({
        invoices: [
          expect.objectContaining({
            contractCode: 'CTR-001',
            legacyCode: 'LEG-001',
            billingMonth: '2026-07',
            today,
            paymentDate: formattedPaymentDate,
            date: formattedPaymentDate,
            referenceNumber: 'REF123456',
            amountUsd: '100,00',
            amountBs: '4000,00',
            exchangeRateUsdToBs: '40,00',
          }),
        ],
      }),
    );
  });

  it('should fallback paymentDate to today when there are no payments', async () => {
    const today = formatDateES(getCaracasNow(), 'dd/MM/yyyy');

    const contract: Partial<Contract> = {
      id: 'contract-2',
      code: 'CTR-002',
      legacyCode: null,
      advisor: null,
      contractPersons: [],
    };

    const mockInvoice: Partial<Invoice> = {
      id: 'inv-2',
      billingMonth: '2026-08',
      totalAmount: 50,
      paidAmount: 0,
      retentionAmount: 0,
      retentionPercentage: 0,
      status: InvoiceStatus.PENDING,
      contract: contract as Contract,
      lines: [],
      payments: [],
    };

    invoiceRepo.findOne.mockResolvedValue(mockInvoice as Invoice);

    await service.buildInvoicePdf('inv-2');

    expect(pdfService.generatePdf).toHaveBeenCalledWith(
      'invoice',
      expect.objectContaining({
        invoices: [
          expect.objectContaining({
            contractCode: 'CTR-002',
            today,
            paymentDate: today,
            date: today,
            amountBs: null,
            exchangeRateUsdToBs: null,
          }),
        ],
      }),
    );
  });
});
