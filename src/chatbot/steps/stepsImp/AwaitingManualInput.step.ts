import { Injectable } from '@nestjs/common';
import { IStepHandler } from '../step-handler.interface';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { ChatbotStateService } from '../../services/chatbot-state.service';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { ChatbotPaymentService } from '../../services/chatbot-payment.service';

@Injectable()
export class AwaitingManualInputStep implements IStepHandler {
  constructor(
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly stateService: ChatbotStateService,
    private readonly chatbotPaymentService: ChatbotPaymentService,
  ) {}

  canHandle(step: Steps): boolean {
    return step === Steps.AWAITING_MANUAL_INPUT;
  }
  async execute(phone: string, message: MetaMessage, state: UserState): Promise<void> {
    const incomingText = message.text?.body?.trim();
    if (!incomingText || !incomingText.includes(',')) {
      await this.metaWhatsappService.sendMessage(
        phone,
        '¡Casi lo tenemos! Pero el formato no es el correcto. ✨\n\nInténtalo de nuevo así: Referencia, Banco, Monto\n(Por ejemplo: 123456, Mercantil, 100)',
      );
      return;
    }

    const parts = incomingText.split(',').map((s) => s.trim());
    let ref: string;
    let banco: string;
    let amountStr: string;

    if (parts.length === 3) {
      ref = parts[0];
      banco = parts[1];
      amountStr = parts[2];
    } else if (parts.length === 4 && /^\d+$/.test(parts[3])) {
      // User entered: Referencia, Banco, MontoEntero, Decimales (e.g. 123456, Mercantil, 100, 50 or 199.608, 64)
      ref = parts[0];
      banco = parts[1];
      const cleanWhole = parts[2].replace(/\./g, '');
      amountStr = `${cleanWhole}.${parts[3]}`;
    } else {
      await this.metaWhatsappService.sendMessage(
        phone,
        '¡Casi lo tenemos! Pero el formato no es el correcto o falta información. ✨\n\nInténtalo de nuevo así: Referencia, Banco, Monto\n(Por ejemplo: 123456, Mercantil, 100)',
      );
      return;
    }

    if (!ref || !banco || !amountStr) {
      await this.metaWhatsappService.sendMessage(
        phone,
        '¡Casi lo tenemos! Pero el formato no es el correcto o falta información. ✨\n\nInténtalo de nuevo así: Referencia, Banco, Monto\n(Por ejemplo: 123456, Mercantil, 100)',
      );
      return;
    }

    let normalizedAmount = amountStr.replace(/\s+/g, '');
    if (normalizedAmount.includes('.') && normalizedAmount.includes(',')) {
      if (normalizedAmount.lastIndexOf(',') > normalizedAmount.lastIndexOf('.')) {
        normalizedAmount = normalizedAmount.replace(/\./g, '').replace(',', '.');
      } else {
        normalizedAmount = normalizedAmount.replace(/,/g, '');
      }
    } else if (normalizedAmount.includes(',')) {
      normalizedAmount = normalizedAmount.replace(',', '.');
    }

    const parsedAmount = Number(normalizedAmount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'El monto ingresado no es válido. Por favor, asegúrate de ingresar un monto numérico mayor a 0.\n\nEjemplo: 123456, Mercantil, 100',
      );
      return;
    }

    const amount = parsedAmount;

    const bancoNormalized = banco.toLowerCase().trim();
    const isZelleBank =
      bancoNormalized.includes('zelle') ||
      [
        'bank of america',
        'wells fargo',
        'chase',
        'citi',
        'citibank',
        'capital one',
        'td bank',
        'pnc',
      ].some((b) => bancoNormalized.includes(b));

    const venezuelanBanks = [
      'mercantil',
      'banesco',
      'venezuela',
      'bdv',
      'provincial',
      'bbva',
      'bancaribe',
      'exterior',
      'bnc',
      'nacional de credito',
      'bancamiga',
      'banplus',
      '100% banco',
      'tesoro',
      'bicentenario',
      'activo',
      'plaza',
      'fondo comun',
      'bfc',
      'caroni',
      'sofitasa',
      'del sur',
    ];
    const isVenezuelanBank = venezuelanBanks.some((vb) => bancoNormalized.includes(vb));

    const isZelle = isZelleBank
      ? true
      : isVenezuelanBank
        ? false
        : state.payment_method?.toLowerCase() === 'zelle';

    if (isZelle) {
      state.payment_method = 'zelle';
    } else if (isVenezuelanBank && state.payment_method?.toLowerCase() === 'zelle') {
      state.payment_method = 'transferencia';
    }

    // Si es Zelle pero aún no se ha capturado el titular de la cuenta
    if (isZelle && !state.zelle_holder_name) {
      state.extracted_data = {
        ...(state.extracted_data || {}),
        referencia: ref,
        monto: amount,
        nombreBanco: banco,
        origen: banco,
        moneda: 'USD',
      };
      state.step = Steps.AWAITING_ZELLE_HOLDER;
      await this.stateService.setState(phone, state);

      await this.metaWhatsappService.sendMessage(
        phone,
        '💳 He registrado los datos de tu pago Zelle.\n\nPor favor, escribe el *nombre y apellido del titular* de la cuenta Zelle desde donde realizaste el pago:',
      );
      return;
    }

    await this.chatbotPaymentService.processPaymentForInvoices(
      phone,
      state,
      ref,
      parts[2] !== undefined ? amount : undefined,
    );
  }
}
