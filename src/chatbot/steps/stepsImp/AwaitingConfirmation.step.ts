import { Injectable, Logger } from '@nestjs/common';
import { IStepHandler } from '../step-handler.interface';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { ChatbotStateService } from '../../services/chatbot-state.service';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { ChatbotPaymentService } from '../../services/chatbot-payment.service';

@Injectable()
export class AwaitingConfirmationStep implements IStepHandler {
  private readonly logger = new Logger(AwaitingConfirmationStep.name);

  constructor(
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly stateService: ChatbotStateService,
    private readonly chatbotPaymentService: ChatbotPaymentService,
  ) {}

  canHandle(step: Steps): boolean {
    return step === Steps.AWAITING_CONFIRMATION;
  }

  async execute(phone: string, message: MetaMessage, state: UserState): Promise<void> {
    const text = (message.text?.body ?? message.interactive?.button_reply?.id ?? '')
      .trim()
      .toLowerCase();

    if (!text) {
      await this.metaWhatsappService.sendMessage(
        phone,
        'Por favor, selecciona una opción válida usando los botones.',
      );
      return;
    }
    if (text === 'datos_correctos') {
      // Atomoically transition to PROCESSING_PAYMENT to prevent duplicate webhooks from double-charging
      state.step = Steps.PROCESSING_PAYMENT;
      await this.stateService.setState(phone, state);

      const ref = (state.extracted_data?.referencia as string) || 'N/A';
      const amount = Number(state.extracted_data?.monto);
      // Proceed to payment processing
      await this.chatbotPaymentService.processPaymentForInvoices(
        phone,
        state,
        ref,
        isNaN(amount) ? undefined : amount,
      );
    } else if (text === 'datos_incorrectos') {
      state.step = Steps.AWAITING_MANUAL_INPUT;
      await this.stateService.setState(phone, state);

      await this.metaWhatsappService.sendMessage(
        phone,
        'Para que el sistema lo reconozca rápido, por favor escribe los datos separados por comas, así: ✍️\n\nReferencia, Banco, Monto\n\n💡 Ejemplo: 123456, Mercantil, 100',
      );
    }
    return;
  }
}
