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
    const parsedAmount = Number(parts[2]);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'El monto ingresado no es válido. Por favor, asegúrate de ingresar un monto numérico mayor a 0.\n\nEjemplo: 123456, Mercantil, 100',
      );
      return;
    }

    const amount = parsedAmount;

    await this.chatbotPaymentService.processPaymentForInvoices(
      phone,
      state,
      ref,
      parts[2] !== undefined ? amount : undefined,
    );
  }
}
