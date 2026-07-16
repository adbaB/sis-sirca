import { Injectable } from '@nestjs/common';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { ChatbotStateService } from '../../services/chatbot-state.service';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { IStepHandler } from '../step-handler.interface';

@Injectable()
export class AwaitingPaymentMethodManualStep implements IStepHandler {
  constructor(
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly stateService: ChatbotStateService,
  ) {}

  canHandle(step: Steps): boolean {
    return step === Steps.AWAITING_PAYMENT_METHOD_MANUAL;
  }
  async execute(phone: string, message: MetaMessage, state: UserState): Promise<void> {
    const text = (message.text?.body || message.interactive?.button_reply?.id || '').trim();
    if (!text) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'Por favor, selecciona una opción válida usando los botones.',
      );
      return;
    }
    let paymentMethodStr: string;
    let paymentInfo: string;

    if (text === 'pm_transferencia' || text.toLowerCase() === 'transferencia') {
      paymentMethodStr = 'transferencia';
      paymentInfo =
        'Banco: Banco Nacional de Credito*\nCuenta: 0191-0169-02-2100132011\nTitular: Salud Integral El Rosario C.A\nRIF: J-501776385';
    } else if (text === 'pm_pago_movil' || text.toLowerCase() === 'pago movil') {
      paymentMethodStr = 'pago_movil';
      paymentInfo =
        'Banco: Banco Nacional de Credito\nTeléfono: 0412-7313398\nRIF: J-501776385\nTitular: Salud Integral El Rosario C.A';
    } else if (text === 'pm_zelle' || text.toLowerCase() === 'zelle') {
      paymentMethodStr = 'zelle';
      paymentInfo =
        'Zelle: platinumclubadmon2@gmail.com\nTitular: Platinum Club Corp\n Cuenta citibank: 9154165049';
    } else {
      await this.metaWhatsappService.sendMessage(
        phone,
        'Por favor, selecciona una opción válida usando los botones.',
      );
      return;
    }

    state.step = Steps.AWAITING_CAPTURE;
    state.payment_method = paymentMethodStr;
    await this.stateService.setState(phone, state);

    await this.metaWhatsappService.sendMessage(
      phone,
      `Aquí tienes los datos para tu pago:\n\n${paymentInfo}\n\nUna vez realizado el pago, por favor envía la imagen del comprobante (capture) por aquí.`,
    );
  }
}
