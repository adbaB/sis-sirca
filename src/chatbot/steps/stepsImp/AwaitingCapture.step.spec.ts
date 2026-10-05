import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AwaitingCaptureStep } from './AwaitingCapture.step';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { OcrService } from '../../../ocr/ocr.service';
import { AwsService } from '../../../aws/aws.service';
import { ChatbotStateService } from '../../services/chatbot-state.service';

describe('AwaitingCaptureStep', () => {
  let step: AwaitingCaptureStep;
  let metaWhatsappService: MetaWhatsappService;
  let ocrService: OcrService;
  let awsService: AwsService;
  let stateService: ChatbotStateService;

  beforeEach(() => {
    metaWhatsappService = {
      sendMessage: vi.fn().mockResolvedValue('msg-id'),
      sendInteractiveMessage: vi.fn().mockResolvedValue('msg-id'),
      downloadMedia: vi.fn().mockResolvedValue(Buffer.from('image-data')),
    } as unknown as MetaWhatsappService;

    ocrService = {
      extractReceiptData: vi.fn(),
    } as unknown as OcrService;

    awsService = {
      uploadFile: vi.fn().mockResolvedValue('https://s3.amazonaws.com/receipts/comprobante.jpg'),
    } as unknown as AwsService;

    stateService = {
      setState: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatbotStateService;

    step = new AwaitingCaptureStep(metaWhatsappService, ocrService, awsService, stateService);
  });

  it('canHandle should return true for AWAITING_CAPTURE', () => {
    expect(step.canHandle(Steps.AWAITING_CAPTURE)).toBe(true);
    expect(step.canHandle(Steps.AWAITING_ZELLE_HOLDER)).toBe(false);
  });

  it('should transition to AWAITING_ZELLE_HOLDER if payment method is Zelle or OCR detects Zelle', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'image',
      image: { id: 'media-123', mime_type: 'image/jpeg' },
    };
    const state: UserState = {
      step: Steps.AWAITING_CAPTURE,
      payment_method: 'zelle',
    };

    vi.mocked(ocrService.extractReceiptData).mockResolvedValue({
      monto: 100,
      referencia: 'WFCT999888',
      beneficiario: 'Platinum Club Corp',
      bancoDestino: null,
      fecha: '05/10/2026',
      origen: 'Wells Fargo',
      moneda: 'USD',
      descripcion: null,
      nombreBanco: 'Wells Fargo',
      esZelle: true,
    });

    await step.execute(phone, message, state);

    expect(state.payment_method).toBe('zelle');
    expect(state.step).toBe(Steps.AWAITING_ZELLE_HOLDER);
    expect(stateService.setState).toHaveBeenCalledWith(phone, state);
    expect(metaWhatsappService.sendMessage).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('titular'),
    );
  });

  it('should transition to AWAITING_ZELLE_HOLDER even if payment method was not zelle but OCR detects US bank / USD', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'image',
      image: { id: 'media-123', mime_type: 'image/jpeg' },
    };
    const state: UserState = {
      step: Steps.AWAITING_CAPTURE,
      payment_method: 'transferencia', // User initially selected transferencia
    };

    vi.mocked(ocrService.extractReceiptData).mockResolvedValue({
      monto: 50,
      referencia: 'CHASE12345',
      beneficiario: null,
      bancoDestino: null,
      fecha: '05/10/2026',
      origen: 'Chase Bank',
      moneda: 'USD',
      descripcion: null,
      nombreBanco: 'Chase Bank',
      esZelle: true,
    });

    await step.execute(phone, message, state);

    expect(state.payment_method).toBe('zelle');
    expect(state.step).toBe(Steps.AWAITING_ZELLE_HOLDER);
    expect(stateService.setState).toHaveBeenCalledWith(phone, state);
    expect(metaWhatsappService.sendMessage).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('titular'),
    );
  });

  it('should transition directly to AWAITING_CONFIRMATION if payment is in bolivares (Pago Movil)', async () => {
    const phone = '584121234567';
    const message: MetaMessage = {
      from: phone,
      type: 'image',
      image: { id: 'media-123', mime_type: 'image/jpeg' },
    };
    const state: UserState = {
      step: Steps.AWAITING_CAPTURE,
      payment_method: 'pago_movil',
    };

    vi.mocked(ocrService.extractReceiptData).mockResolvedValue({
      monto: 500,
      referencia: '12345678',
      beneficiario: 'Salud Integral El Rosario',
      bancoDestino: 'Banco Nacional de Crédito',
      fecha: '05/10/2026',
      origen: 'Banesco',
      moneda: 'Bs',
      descripcion: 'Pago Móvil',
      nombreBanco: 'Banesco',
      esZelle: false,
    });

    await step.execute(phone, message, state);

    expect(state.step).toBe(Steps.AWAITING_CONFIRMATION);
    expect(stateService.setState).toHaveBeenCalledWith(phone, state);
    expect(metaWhatsappService.sendInteractiveMessage).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('He revisado tu comprobante'),
      expect.arrayContaining([
        expect.objectContaining({ reply: { id: 'datos_correctos', title: 'Sí, son correctos' } }),
      ]),
    );
  });
});
