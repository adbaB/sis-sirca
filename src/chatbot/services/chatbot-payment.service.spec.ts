import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ChatbotPaymentService } from './chatbot-payment.service';
import { PersonsService } from '../../persons/services/persons.service';
import { MetaWhatsappService } from './meta-whatsapp.service';
import { ChatbotStateService } from './chatbot-state.service';
import { ChatbotAnalyticsService } from './chatbot-analytics.service';
import { ExchangeRateService } from '../../exchange-rate/services/exchange-rate.service';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import { PaymentService } from '../../billing/payments/services/payment.service';
import { UserState } from '../interfaces/userState.interface';
import { Steps } from '../enums/steps.enum';
import { PaymentOrigin } from '../../billing/payments/entities/payment.entity';
import * as dateUtil from '../../common/utils/date.util';
import { TypeIdentityCard } from '../../persons/entities/person.entity';

describe('ChatbotPaymentService', () => {
  let service: ChatbotPaymentService;
  let paymentService: PaymentService;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockPersonsService = {
    findByIdentityCard: jest.fn().mockResolvedValue({ id: 'person-123' }),
  };

  const mockMetaWhatsappService = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
  };

  const mockStateService = {
    clearState: jest.fn().mockResolvedValue(undefined),
  };

  const mockAnalyticsService = {
    trackCompletion: jest.fn().mockResolvedValue(undefined),
  };

  const mockExchangeRateService = {
    getExchangeRateByDate: jest.fn(),
  };

  const mockInvoiceService = {
    findInvoicesByIds: jest.fn(),
  };

  const mockPaymentService = {
    createPayment: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotPaymentService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: PersonsService, useValue: mockPersonsService },
        { provide: MetaWhatsappService, useValue: mockMetaWhatsappService },
        { provide: ChatbotStateService, useValue: mockStateService },
        { provide: ChatbotAnalyticsService, useValue: mockAnalyticsService },
        { provide: ExchangeRateService, useValue: mockExchangeRateService },
        { provide: InvoiceService, useValue: mockInvoiceService },
        { provide: PaymentService, useValue: mockPaymentService },
      ],
    }).compile();

    service = module.get<ChatbotPaymentService>(ChatbotPaymentService);
    paymentService = module.get<PaymentService>(PaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processPaymentForInvoices', () => {
    it('should use receipt rate for paid amount and current day rate for pending balance calculation', async () => {
      const fromNumber = '+584121234567';
      const state: UserState = {
        step: Steps.AWAITING_CONFIRMATION,
        identity_card: '12345678',
        type_identity_card: TypeIdentityCard.V,
        payment_method: 'transferencia',
        selected_invoices_details: [{ id: 'inv-1', amount: 50 }],
        extracted_data: {
          referencia: 'REF999',
          monto: 380, // 380 Bs paid on August 21
          fecha: '2026-08-21',
        },
      };

      // Mock exchange rate: 38 Bs/$ on August 21 (receipt date), 40 Bs/$ on current day (today)
      mockExchangeRateService.getExchangeRateByDate.mockImplementation(
        (dateInput: string | Date) => {
          const dateStr = dateUtil.formatToISODateString(dateInput);
          if (dateStr === '2026-08-21') {
            return Promise.resolve({ rateUsd: 38 });
          }
          return Promise.resolve({ rateUsd: 40 }); // Today's rate
        },
      );

      // Invoice after payment: was 50 USD, 380 Bs at 38 Bs/$ = 10 USD paid. Remaining = 40 USD.
      mockInvoiceService.findInvoicesByIds.mockResolvedValueOnce([
        {
          id: 'inv-1',
          billingMonth: '2026-08',
          totalAmount: '50.00',
          paidAmount: '10.00',
        },
      ]);

      await service.processPaymentForInvoices(fromNumber, state, 'REF999', 380);

      // Verify payment creation was called with receipt date
      expect(paymentService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 'inv-1',
          amount: 50,
          amountExtracted: 380,
          datePaymentReceipt: '2026-08-21',
          origin: PaymentOrigin.BOT,
        }),
        mockQueryRunner,
      );

      // Verify final message sent to user:
      // Paid amount in USD should be 380 / 38 = 10.00 USD
      // Pending amount is 40.00 USD.
      // Pending amount in Bs should use TODAY'S rate (40 Bs/$), so 40 * 40 = 1600.00 Bs (NOT 40 * 38 = 1520.00 Bs)
      expect(mockMetaWhatsappService.sendMessage).toHaveBeenCalledWith(
        fromNumber,
        expect.stringContaining('Tu pago de $10.00 ha sido registrado con éxito.'),
      );
      expect(mockMetaWhatsappService.sendMessage).toHaveBeenCalledWith(
        fromNumber,
        expect.stringContaining('Aún queda un saldo pendiente total de $40.00 (Bs. 1600.00).'),
      );
    });

    it('should show breakdown with today rate when multiple invoices have pending balance', async () => {
      const fromNumber = '+584121234567';
      const state: UserState = {
        step: Steps.AWAITING_CONFIRMATION,
        identity_card: '12345678',
        type_identity_card: TypeIdentityCard.V,
        payment_method: 'pago_movil',
        selected_invoices_details: [
          { id: 'inv-1', amount: 20 },
          { id: 'inv-2', amount: 30 },
        ],
        extracted_data: {
          referencia: 'REF888',
          monto: 380, // 380 Bs paid on August 21
          fecha: '2026-08-21',
        },
      };

      mockExchangeRateService.getExchangeRateByDate.mockImplementation(
        (dateInput: string | Date) => {
          const dateStr = dateUtil.formatToISODateString(dateInput);
          if (dateStr === '2026-08-21') {
            return Promise.resolve({ rateUsd: 38 });
          }
          return Promise.resolve({ rateUsd: 50 }); // Today's rate = 50 Bs/$
        },
      );

      mockInvoiceService.findInvoicesByIds.mockResolvedValueOnce([
        {
          id: 'inv-1',
          billingMonth: '2026-07',
          totalAmount: '20.00',
          paidAmount: '20.00', // fully paid
        },
        {
          id: 'inv-2',
          billingMonth: '2026-08',
          totalAmount: '30.00',
          paidAmount: '10.00', // 20 USD pending
        },
      ]);

      await service.processPaymentForInvoices(fromNumber, state, 'REF888', 380);

      // Pending for inv-2 is $20.00 -> at today's rate (50) it's Bs. 1000.00
      expect(mockMetaWhatsappService.sendMessage).toHaveBeenCalledWith(
        fromNumber,
        expect.stringContaining('- Mes 2026-07: Pagada en su totalidad ✅'),
      );
      expect(mockMetaWhatsappService.sendMessage).toHaveBeenCalledWith(
        fromNumber,
        expect.stringContaining('- Mes 2026-08: Queda pendiente $20.00 (Bs. 1000.00)'),
      );
      expect(mockMetaWhatsappService.sendMessage).toHaveBeenCalledWith(
        fromNumber,
        expect.stringContaining('Aún queda un saldo pendiente total de $20.00 (Bs. 1000.00).'),
      );
    });

    it('should show fully paid message when all invoices are completed', async () => {
      const fromNumber = '+584121234567';
      const state: UserState = {
        step: Steps.AWAITING_CONFIRMATION,
        payment_method: 'zelle',
        selected_invoices_details: [{ id: 'inv-1', amount: 50 }],
        extracted_data: {
          referencia: 'ZELLE123',
          monto: 50,
          fecha: '2026-08-21',
        },
      };

      mockExchangeRateService.getExchangeRateByDate.mockResolvedValue({ rateUsd: 40 });
      mockInvoiceService.findInvoicesByIds.mockResolvedValueOnce([
        {
          id: 'inv-1',
          billingMonth: '2026-08',
          totalAmount: '50.00',
          paidAmount: '50.00',
        },
      ]);

      await service.processPaymentForInvoices(fromNumber, state, 'ZELLE123', 50);

      expect(mockMetaWhatsappService.sendMessage).toHaveBeenCalledWith(
        fromNumber,
        expect.stringContaining('¡Tus facturas seleccionadas han sido pagadas en su totalidad! 🥳'),
      );
    });
  });
});
