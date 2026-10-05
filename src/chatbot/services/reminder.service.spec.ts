import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderService } from './reminder.service';
import { MetaWhatsappService } from './meta-whatsapp.service';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import { ChatbotStateService } from './chatbot-state.service';
import { WHATSAPP_TEMPLATES } from '../constants/whatsapp-templates.contants';
import { Person } from '../../persons/entities/person.entity';
import { Invoice } from '../../billing/invoices/entities/invoice.entity';
import { ConfigType } from '@nestjs/config';
import config from '../../config/configurations';

describe('ReminderService', () => {
  let service: ReminderService;
  let whatsappService: MetaWhatsappService;
  let invoiceService: InvoiceService;
  let stateService: ChatbotStateService;

  const mockConfig = {
    meta: {
      templateLanguage: 'es',
    },
  };

  beforeEach(() => {
    whatsappService = {
      sendTemplateMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as MetaWhatsappService;

    invoiceService = {
      findPendingInvoicesByBillingMonth: vi.fn().mockResolvedValue([]),
    } as unknown as InvoiceService;

    stateService = {
      setState: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatbotStateService;

    service = new ReminderService(
      whatsappService,
      invoiceService,
      stateService,
      mockConfig as unknown as ConfigType<typeof config>,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should process pending invoices, normalize phone numbers and send template messages', async () => {
    const mockInvoices: Invoice[] = [
      {
        id: 'inv-1',
        billingMonth: '2026-09',
        totalAmount: '100',
        paidAmount: '0',
        contract: {
          contractPersons: [
            {
              isBillingOwner: true,
              person: {
                id: 'person-1',
                name: 'juan perez',
                phone: '04141234567',
              } as Person,
            },
          ],
        },
      } as unknown as Invoice,
    ];

    vi.spyOn(invoiceService, 'findPendingInvoicesByBillingMonth').mockResolvedValue(mockInvoices);

    await service.handleDay25Reminder();

    expect(whatsappService.sendTemplateMessage).toHaveBeenCalledWith(
      '584141234567',
      WHATSAPP_TEMPLATES.REMINDER_DAY_25,
      expect.objectContaining({
        nombre: 'Juan Perez',
        monto: '100.00$',
      }),
      'es',
      'REMINDER_person-1',
    );

    expect(stateService.setState).toHaveBeenCalledWith('584141234567', {
      step: 'AWAITING_FLOW_INTERACTION',
    });
  });

  it('should skip debtors with invalid or missing phone numbers', async () => {
    const mockInvoices: Invoice[] = [
      {
        id: 'inv-1',
        billingMonth: '2026-09',
        totalAmount: '100',
        paidAmount: '0',
        contract: {
          contractPersons: [
            {
              isBillingOwner: true,
              person: {
                id: 'person-invalid',
                name: 'sin telefono',
                phone: '123',
              } as Person,
            },
          ],
        },
      } as unknown as Invoice,
    ];

    vi.spyOn(invoiceService, 'findPendingInvoicesByBillingMonth').mockResolvedValue(mockInvoices);

    await service.handleDay25Reminder();

    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled();
    expect(stateService.setState).not.toHaveBeenCalled();
  });

  it('should continue processing remaining debts even if one message fails', async () => {
    const mockInvoices: Invoice[] = [
      {
        id: 'inv-1',
        billingMonth: '2026-09',
        totalAmount: '50',
        paidAmount: '0',
        contract: {
          contractPersons: [
            {
              isBillingOwner: true,
              person: {
                id: 'person-err',
                name: 'Pedro Error',
                phone: '+584226507898',
              } as Person,
            },
          ],
        },
      } as unknown as Invoice,
      {
        id: 'inv-2',
        billingMonth: '2026-09',
        totalAmount: '80',
        paidAmount: '0',
        contract: {
          contractPersons: [
            {
              isBillingOwner: true,
              person: {
                id: 'person-ok',
                name: 'Maria Exito',
                phone: '+584149998877',
              } as Person,
            },
          ],
        },
      } as unknown as Invoice,
    ];

    vi.spyOn(invoiceService, 'findPendingInvoicesByBillingMonth').mockResolvedValue(mockInvoices);

    const axiosError = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          error: {
            message: '(#131026) Message undeliverable',
            code: 131026,
          },
        },
      },
    };

    vi.spyOn(whatsappService, 'sendTemplateMessage')
      .mockRejectedValueOnce(axiosError)
      .mockResolvedValueOnce(undefined);

    await service.handleDay25Reminder();

    expect(whatsappService.sendTemplateMessage).toHaveBeenCalledTimes(2);
    expect(whatsappService.sendTemplateMessage).toHaveBeenNthCalledWith(
      1,
      '584226507898',
      expect.any(String),
      expect.any(Object),
      'es',
      'REMINDER_person-err',
    );
    expect(whatsappService.sendTemplateMessage).toHaveBeenNthCalledWith(
      2,
      '584149998877',
      expect.any(String),
      expect.any(Object),
      'es',
      'REMINDER_person-ok',
    );
  });
});
