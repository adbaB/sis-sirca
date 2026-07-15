import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { InvoiceService } from '../invoices/services/invoice.service';
import { PaymentService } from '../payment/services/payment.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { CreateAdditionalChargeDto } from '../dto/create-additional-charge.dto';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { PdfService } from '../../pdf/services/pdf.service';
import { QueryRunner, EntityManager } from 'typeorm';
import { TransactionResult } from '../payment/interfaces/payment.interface';
import { Payment } from '../entities/payment.entity';
import { Invoice } from '../invoices/entities/invoice.entity';

describe('BillingService (Delegation)', () => {
  let service: BillingService;
  let invoiceService: jest.Mocked<InvoiceService>;
  let paymentService: jest.Mocked<PaymentService>;

  const mockInvoiceService = {
    findInvoicesByIds: jest.fn(),
    findPendingInvoicesByIdentityCard: jest.fn(),
    calculateAmountByInvoicesIds: jest.fn(),
    recalculateInvoicePaidAmount: jest.fn(),
    recalculateInvoiceAmountFromContract: jest.fn(),
    generateInvoiceForContract: jest.fn(),
    buildInvoicePdf: jest.fn(),
    addAdditionalCharge: jest.fn(),
    removeAdditionalCharge: jest.fn(),
    removeAffiliateLineFromActiveInvoice: jest.fn(),
    updatePlanLineOnActiveInvoice: jest.fn(),
  };

  const mockPaymentService = {
    createPayment: jest.fn(),
    findPayments: jest.fn(),
    countPendingPayments: jest.fn(),
    approvePayment: jest.fn(),
    rejectPayment: jest.fn(),
    updatePaymentDate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: InvoiceService,
          useValue: mockInvoiceService,
        },
        {
          provide: PaymentService,
          useValue: mockPaymentService,
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    invoiceService = module.get(InvoiceService) as jest.Mocked<InvoiceService>;
    paymentService = module.get(PaymentService) as jest.Mocked<PaymentService>;

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('paymentService delegations', () => {
    it('should delegate createPayment', async () => {
      const dto = { amount: 100 } as CreatePaymentDto;
      const qr = {} as QueryRunner;
      paymentService.createPayment.mockResolvedValue(
        'createPayment-res' as unknown as TransactionResult,
      );
      const res = await service.createPayment(dto, qr);
      expect(paymentService.createPayment).toHaveBeenCalledWith(dto, qr);
      expect(res).toBe('createPayment-res');
    });

    it('should delegate findPayments', async () => {
      paymentService.findPayments.mockResolvedValue(
        'findPayments-res' as unknown as ReturnType<PaymentService['findPayments']>,
      );
      const res = await service.findPayments(1, 10, 'status', 'search', 5, 2026);
      expect(paymentService.findPayments).toHaveBeenCalledWith(1, 10, 'status', 'search', 5, 2026);
      expect(res).toBe('findPayments-res');
    });

    it('should delegate countPendingPayments', async () => {
      paymentService.countPendingPayments.mockResolvedValue(5);
      const res = await service.countPendingPayments();
      expect(paymentService.countPendingPayments).toHaveBeenCalled();
      expect(res).toBe(5);
    });

    it('should delegate approvePayment', async () => {
      paymentService.approvePayment.mockResolvedValue('approvePayment-res' as unknown as Payment);
      const res = await service.approvePayment('id');
      expect(paymentService.approvePayment).toHaveBeenCalledWith('id');
      expect(res).toBe('approvePayment-res');
    });

    it('should delegate rejectPayment', async () => {
      paymentService.rejectPayment.mockResolvedValue('rejectPayment-res' as unknown as Payment);
      const res = await service.rejectPayment('id', 'reason');
      expect(paymentService.rejectPayment).toHaveBeenCalledWith('id', 'reason');
      expect(res).toBe('rejectPayment-res');
    });

    it('should delegate updatePaymentDate', async () => {
      paymentService.updatePaymentDate.mockResolvedValue(
        'updatePaymentDate-res' as unknown as Payment,
      );
      const res = await service.updatePaymentDate('id', 'date');
      expect(paymentService.updatePaymentDate).toHaveBeenCalledWith('id', 'date');
      expect(res).toBe('updatePaymentDate-res');
    });
  });

  describe('invoiceService delegations', () => {
    it('should delegate findInvoicesByIds', async () => {
      invoiceService.findInvoicesByIds.mockResolvedValue(
        'findInvoicesByIds-res' as unknown as Invoice[],
      );
      const res = await service.findInvoicesByIds(['id']);
      expect(invoiceService.findInvoicesByIds).toHaveBeenCalledWith(['id']);
      expect(res).toBe('findInvoicesByIds-res');
    });

    it('should delegate findPendingInvoicesByIdentityCard', async () => {
      invoiceService.findPendingInvoicesByIdentityCard.mockResolvedValue(
        'findPendingInvoicesByIdentityCard-res' as unknown as Invoice[],
      );
      const res = await service.findPendingInvoicesByIdentityCard('id', TypeIdentityCard.V);
      expect(invoiceService.findPendingInvoicesByIdentityCard).toHaveBeenCalledWith(
        'id',
        TypeIdentityCard.V,
      );
      expect(res).toBe('findPendingInvoicesByIdentityCard-res');
    });

    it('should delegate calculateAmountByInvoicesIds', async () => {
      invoiceService.calculateAmountByInvoicesIds.mockResolvedValue(123);
      const res = await service.calculateAmountByInvoicesIds(['id'], 'method');
      expect(invoiceService.calculateAmountByInvoicesIds).toHaveBeenCalledWith(['id'], 'method');
      expect(res).toBe(123);
    });

    it('should delegate recalculateInvoicePaidAmount', async () => {
      const qr = {} as QueryRunner;
      invoiceService.recalculateInvoicePaidAmount.mockResolvedValue(undefined);
      await service.recalculateInvoicePaidAmount('id', qr);
      expect(invoiceService.recalculateInvoicePaidAmount).toHaveBeenCalledWith('id', qr);
    });

    it('should delegate recalculateInvoiceAmountFromContract', async () => {
      invoiceService.recalculateInvoiceAmountFromContract.mockResolvedValue(
        'recalculateInvoiceAmountFromContract-res' as unknown as Invoice,
      );
      const res = await service.recalculateInvoiceAmountFromContract('id');
      expect(invoiceService.recalculateInvoiceAmountFromContract).toHaveBeenCalledWith('id');
      expect(res).toBe('recalculateInvoiceAmountFromContract-res');
    });

    it('should delegate generateInvoiceForContract', async () => {
      invoiceService.generateInvoiceForContract.mockResolvedValue(
        'generateInvoiceForContract-res' as unknown as Invoice,
      );
      const res = await service.generateInvoiceForContract('id', 'month');
      expect(invoiceService.generateInvoiceForContract).toHaveBeenCalledWith('id', 'month', false);
      expect(res).toBe('generateInvoiceForContract-res');
    });

    it('should delegate buildInvoicePdf', async () => {
      const pdfService = {} as PdfService;
      invoiceService.buildInvoicePdf.mockResolvedValue({
        pdfBuffer: Buffer.from(''),
        filename: 'file',
      });
      const res = await service.buildInvoicePdf('id', pdfService);
      expect(invoiceService.buildInvoicePdf).toHaveBeenCalledWith('id', pdfService);
      expect(res).toEqual({ pdfBuffer: Buffer.from(''), filename: 'file' });
    });

    it('should delegate addAdditionalCharge', async () => {
      const dto = {} as CreateAdditionalChargeDto;
      invoiceService.addAdditionalCharge.mockResolvedValue(
        'addAdditionalCharge-res' as unknown as Invoice,
      );
      const res = await service.addAdditionalCharge('id', dto);
      expect(invoiceService.addAdditionalCharge).toHaveBeenCalledWith('id', dto);
      expect(res).toBe('addAdditionalCharge-res');
    });

    it('should delegate removeAdditionalCharge', async () => {
      invoiceService.removeAdditionalCharge.mockResolvedValue(
        'removeAdditionalCharge-res' as unknown as Invoice,
      );
      const res = await service.removeAdditionalCharge('id', 'lineId');
      expect(invoiceService.removeAdditionalCharge).toHaveBeenCalledWith('id', 'lineId');
      expect(res).toBe('removeAdditionalCharge-res');
    });

    it('should delegate removeAffiliateLineFromActiveInvoice', async () => {
      const manager = {} as EntityManager;
      invoiceService.removeAffiliateLineFromActiveInvoice.mockResolvedValue(undefined);
      await service.removeAffiliateLineFromActiveInvoice('contractId', 'personId', manager);
      expect(invoiceService.removeAffiliateLineFromActiveInvoice).toHaveBeenCalledWith(
        'contractId',
        'personId',
        manager,
      );
    });

    it('should delegate updatePlanLineOnActiveInvoice', async () => {
      invoiceService.updatePlanLineOnActiveInvoice.mockResolvedValue(undefined);
      await service.updatePlanLineOnActiveInvoice(
        'contractId',
        'personId',
        'planId',
        100,
        'planName',
      );
      expect(invoiceService.updatePlanLineOnActiveInvoice).toHaveBeenCalledWith(
        'contractId',
        'personId',
        'planId',
        100,
        'planName',
      );
    });
  });
});
