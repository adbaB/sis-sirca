import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AwaitingManualInputStep } from './AwaitingManualInput.step';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { ChatbotStateService } from '../../services/chatbot-state.service';
import { ChatbotPaymentService } from '../../services/chatbot-payment.service';

describe('AwaitingManualInputStep', () => {
  let step: AwaitingManualInputStep;
  let metaWhatsappService: MetaWhatsappService;
  let stateService: ChatbotStateService;
  let chatbotPaymentService: ChatbotPaymentService;

  beforeEach(() => {
    metaWhatsappService = {
      sendMessage: vi.fn().mockResolvedValue('msg-id'),
    } as unknown as MetaWhatsappService;

    stateService = {
      setState: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatbotStateService;

    chatbotPaymentService = {
      processPaymentForInvoices: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatbotPaymentService;

    step = new AwaitingManualInputStep(metaWhatsappService, stateService, chatbotPaymentService);
  });

  it('canHandle should return true for AWAITING_MANUAL_INPUT', () => {
    expect(step.canHandle(Steps.AWAITING_MANUAL_INPUT)).toBe(true);
    expect(step.canHandle(Steps.AWAITING_CAPTURE)).toBe(false);
  });

  it('should reject invalid input without comma', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: '123456 Mercantil 100' },
    };
    const state: UserState = { step: Steps.AWAITING_MANUAL_INPUT };

    await step.execute(phone, message, state);

    expect(metaWhatsappService.sendMessage).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('formato no es el correcto'),
    );
    expect(chatbotPaymentService.processPaymentForInvoices).not.toHaveBeenCalled();
  });

  it('should transition to AWAITING_ZELLE_HOLDER if payment is Zelle and holder is not yet provided', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: 'WFCT123, Zelle, 50' },
    };
    const state: UserState = {
      step: Steps.AWAITING_MANUAL_INPUT,
      payment_method: 'zelle',
    };

    await step.execute(phone, message, state);

    expect(state.step).toBe(Steps.AWAITING_ZELLE_HOLDER);
    expect(stateService.setState).toHaveBeenCalledWith(phone, state);
    expect(metaWhatsappService.sendMessage).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('titular'),
    );
    expect(chatbotPaymentService.processPaymentForInvoices).not.toHaveBeenCalled();
  });

  it('should reuse existing zelle_holder_name if already set and proceed to payment', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: 'WFCT123, Wells Fargo, 50' },
    };
    const state: UserState = {
      step: Steps.AWAITING_MANUAL_INPUT,
      payment_method: 'zelle',
      zelle_holder_name: 'María González',
    };

    await step.execute(phone, message, state);

    expect(chatbotPaymentService.processPaymentForInvoices).toHaveBeenCalledWith(
      phone,
      state,
      'WFCT123',
      50,
    );
    expect(state.step).toBe(Steps.AWAITING_MANUAL_INPUT);
  });

  it('should process payment directly for bolivares payment without asking holder', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: '123456, Mercantil, 100' },
    };
    const state: UserState = {
      step: Steps.AWAITING_MANUAL_INPUT,
      payment_method: 'pago_movil',
    };

    await step.execute(phone, message, state);

    expect(chatbotPaymentService.processPaymentForInvoices).toHaveBeenCalledWith(
      phone,
      state,
      '123456',
      100,
    );
  });

  it('should override false-positive zelle state if user manually enters a Venezuelan bank like Mercantil', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: '123456, Mercantil, 100' },
    };
    const state: UserState = {
      step: Steps.AWAITING_MANUAL_INPUT,
      payment_method: 'zelle', // set erroneously by prior OCR
    };

    await step.execute(phone, message, state);

    expect(state.payment_method).toBe('transferencia');
    expect(chatbotPaymentService.processPaymentForInvoices).toHaveBeenCalledWith(
      phone,
      state,
      '123456',
      100,
    );
    expect(state.step).toBe(Steps.AWAITING_MANUAL_INPUT);
  });
});
