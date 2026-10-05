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
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      await this.metaWhatsappService.sendMessage(
        phone,
        '¡Casi lo tenemos! Pero el formato no es el correcto o falta información. ✨\n\nInténtalo de nuevo así: Referencia, Banco, Monto\n(Por ejemplo: 123456, Mercantil, 100)',
      );
      return;
    }

    const ref = parts[0];
    const banco = parts[1];
    const parsedAmount = Number(parts[2]);

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
