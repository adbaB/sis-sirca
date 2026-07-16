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
    const ref = parts[0] || 'N/A';
    const amount = parts[2] ? Number(parts[2]) : Number(state.total_amount);

    await this.chatbotPaymentService.processPaymentForInvoices(
      phone,
      state,
      ref,
      parts[2] !== undefined ? amount : undefined,
    );
  }
}
