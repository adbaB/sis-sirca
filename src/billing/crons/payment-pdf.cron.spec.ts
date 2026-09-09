import { Test, TestingModule } from '@nestjs/testing';
import { PaymentPdfCron } from './payment-pdf.cron';
import { PaymentService } from '../payments/services/payment.service';
import { PdfService } from '../../pdf/services/pdf.service';
import { EmailService } from '../../email/email.service';
import { AwsService } from '../../aws/aws.service';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import configurations from '../../config/configurations';
import { Payment } from '../payments/entities/payment.entity';
import { Invoice } from '../invoices/entities/invoice.entity';

describe('PaymentPdfCron', () => {
  let cron: PaymentPdfCron;
  let exchangeRateService: { getExchangeRateByDate: jest.Mock };

  beforeEach(async () => {
    exchangeRateService = {
      getExchangeRateByDate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentPdfCron,
        {
          provide: PaymentService,
          useValue: { findUnsetPayment: jest.fn() },
        },
        {
          provide: PdfService,
          useValue: { generatePdf: jest.fn() },
        },
        {
          provide: EmailService,
          useValue: { sendEmail: jest.fn() },
        },
        {
          provide: AwsService,
          useValue: { uploadFile: jest.fn() },
        },
        {
          provide: ExchangeRateService,
          useValue: exchangeRateService,
        },
        {
          provide: configurations.KEY,
          useValue: { adminEmail: 'admin@test.com' },
        },
      ],
    }).compile();

    cron = module.get<PaymentPdfCron>(PaymentPdfCron);
  });

  it('should calculate exchangeRateUsdToBs using ExchangeRateService for paymentDate', async () => {
    const paymentDate = new Date('2026-09-08T12:00:00Z');
    exchangeRateService.getExchangeRateByDate.mockResolvedValue({
      rateUsd: 820.1,
    });

    const payment = {
      id: 'pay-1',
      amount: 26.83,
      amountBs: 22000,
      paymentDate,
      invoice: {
        totalAmount: 26.83,
        paidAmount: 26.83,
      } as Invoice,
    } as Payment;

    // Call private method via index signature
    const info = await (
      cron as unknown as {
        calculateFinancialInfo: (p: Payment) => Promise<{ exchangeRateUsdToBs: string | null }>;
      }
    ).calculateFinancialInfo(payment);

    expect(exchangeRateService.getExchangeRateByDate).toHaveBeenCalledWith(paymentDate);
    // Should be '820,10', NOT corrupted to '820,13'
    expect(info.exchangeRateUsdToBs).toBe('820,10');
  });

  it('should return null exchangeRateUsdToBs when amountBs is null or 0', async () => {
    const payment = {
      id: 'pay-2',
      amount: 50.0,
      amountBs: null,
      paymentDate: new Date('2026-09-08T12:00:00Z'),
      invoice: {
        totalAmount: 50.0,
        paidAmount: 50.0,
      } as Invoice,
    } as Payment;

    const info = await (
      cron as unknown as {
        calculateFinancialInfo: (p: Payment) => Promise<{ exchangeRateUsdToBs: string | null }>;
      }
    ).calculateFinancialInfo(payment);

    expect(exchangeRateService.getExchangeRateByDate).not.toHaveBeenCalled();
    expect(info.exchangeRateUsdToBs).toBeNull();
  });
});
