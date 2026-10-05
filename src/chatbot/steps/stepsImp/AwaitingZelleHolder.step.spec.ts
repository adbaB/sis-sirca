import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AwaitingZelleHolderStep } from './AwaitingZelleHolder.step';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { ChatbotStateService } from '../../services/chatbot-state.service';

describe('AwaitingZelleHolderStep', () => {
  let step: AwaitingZelleHolderStep;
  let metaWhatsappService: MetaWhatsappService;
  let stateService: ChatbotStateService;

  beforeEach(() => {
    metaWhatsappService = {
      sendMessage: vi.fn().mockResolvedValue('msg-id'),
      sendInteractiveMessage: vi.fn().mockResolvedValue('msg-id'),
    } as unknown as MetaWhatsappService;

    stateService = {
      setState: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatbotStateService;

    step = new AwaitingZelleHolderStep(metaWhatsappService, stateService);
  });

  it('canHandle should return true only for AWAITING_ZELLE_HOLDER', () => {
    expect(step.canHandle(Steps.AWAITING_ZELLE_HOLDER)).toBe(true);
    expect(step.canHandle(Steps.AWAITING_CAPTURE)).toBe(false);
    expect(step.canHandle(Steps.AWAITING_CONFIRMATION)).toBe(false);
  });

  it('should reject empty or whitespace text', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: '   ' },
    };
    const state: UserState = {
      step: Steps.AWAITING_ZELLE_HOLDER,
    };

    await step.execute(phone, message, state);

    expect(metaWhatsappService.sendMessage).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('nombre y apellido válido'),
    );
    expect(stateService.setState).not.toHaveBeenCalled();
    expect(state.step).toBe(Steps.AWAITING_ZELLE_HOLDER);
  });

  it('should reject text shorter than 3 characters or with no letters', async () => {
    const phone = '584121234567';
    const messageNum: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: '123456' },
    };
    const state: UserState = {
      step: Steps.AWAITING_ZELLE_HOLDER,
    };

    await step.execute(phone, messageNum, state);

    expect(metaWhatsappService.sendMessage).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('nombre y apellido válido'),
    );
    expect(stateService.setState).not.toHaveBeenCalled();

    const messageShort: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: 'ab' },
    };
    await step.execute(phone, messageShort, state);
    expect(stateService.setState).not.toHaveBeenCalled();

    // Rechazar un solo nombre o palabra (ej: 'Ana' o '123a')
    const messageSingleWord: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: 'Ana' },
    };
    await step.execute(phone, messageSingleWord, state);
    expect(stateService.setState).not.toHaveBeenCalled();
    expect(state.step).toBe(Steps.AWAITING_ZELLE_HOLDER);
  });

  it('should not update state if sendInteractiveMessage fails', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: 'Juan Perez' },
    };
    const state: UserState = {
      step: Steps.AWAITING_ZELLE_HOLDER,
    };

    vi.spyOn(metaWhatsappService, 'sendInteractiveMessage').mockRejectedValueOnce(
      new Error('WhatsApp API error'),
    );

    await expect(step.execute(phone, message, state)).rejects.toThrow('WhatsApp API error');
    expect(stateService.setState).not.toHaveBeenCalled();
    expect(state.step).toBe(Steps.AWAITING_ZELLE_HOLDER);
  });

  it('should accept valid holder name and transition to AWAITING_CONFIRMATION with interactive summary', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'text',
      text: { body: ' Juan Carlos Pérez ' },
    };
    const state: UserState = {
      step: Steps.AWAITING_ZELLE_HOLDER,
      payment_method: 'zelle',
      extracted_data: {
        referencia: 'WFCT999888',
        monto: 75,
        moneda: '$',
      },
    };

    await step.execute(phone, message, state);

    expect(state.zelle_holder_name).toBe('Juan Carlos Pérez');
    expect(state.extracted_data?.titularZelle).toBe('Juan Carlos Pérez');
    expect(state.step).toBe(Steps.AWAITING_CONFIRMATION);
    expect(stateService.setState).toHaveBeenCalledWith(phone, state);

    expect(metaWhatsappService.sendInteractiveMessage).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Juan Carlos Pérez'),
      expect.arrayContaining([
        expect.objectContaining({ reply: { id: 'datos_correctos', title: 'Sí, son correctos' } }),
        expect.objectContaining({ reply: { id: 'datos_incorrectos', title: 'Ingreso manual' } }),
      ]),
    );
  });
});
