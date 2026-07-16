import { Inject, Injectable, Logger } from '@nestjs/common';
import { MetaWhatsappService } from './meta-whatsapp.service';
import { UserState } from '../interfaces/userState.interface';
import { ChatbotStateService } from './chatbot-state.service';
import { Steps } from '../enums/steps.enum';
import { MetaMessage, MetaStatus, WebhookBody } from '../interfaces/webhook.interface';
import { IStepHandler } from '../steps/step-handler.interface';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly stateService: ChatbotStateService,
    @Inject('STEP_HANDLERS') private readonly stepHandlers: IStepHandler[],
  ) {}

  async handleIncomingMessage(body: WebhookBody): Promise<void> {
    try {
      const message = this.extractMessage(body);
      const status = this.extractStatus(body);

      if (status && status.status === 'failed' && status.errors) {
        return this.handleStatusError(status);
      }

      if (!message) {
        return;
      }

      const fromNumber = message.from;
      const incomingText = this.extractText(message);

      let state: UserState | null = await this.stateService.getState(fromNumber);

      // If no state or user wants to restart, initialize state.
      if (
        !state ||
        incomingText?.toLowerCase() === 'hola' ||
        incomingText?.toLowerCase() === 'reiniciar'
      ) {
        state = { step: Steps.AWAITING_NAME };
        await this.stateService.clearState(fromNumber); // Reset
        await this.handleGreeting(fromNumber);
        await this.stateService.setState(fromNumber, state);

        return;
      }

      // Handle Flow completion (nfm_reply)
      if (message.interactive?.nfm_reply) {
        return this.handleFlowCompletion(fromNumber, message, state);
      }

      // Handle Interactive button replies for the Main Menu
      if (incomingText === 'info_planes') {
        await this.metaWhatsappService.sendMessage(
          fromNumber,
          '¡Claro! Te pongo en contacto con nuestros asesores comerciales para que te dé todos los detalles de los planes. ✨\n\nEllos te esperan por aquí:\n📱 *WhatsApp:* +58 424-6537074 / +58 412-1201012\n\n¡Seguro encontrará el plan ideal para ti! 😊',
        );
        await this.stateService.clearState(fromNumber);
        return;
      }

      if (incomingText === 'realizar_pago') {
        return this.initPaymentFlow(fromNumber, state);
      }

      const handler = this.stepHandlers.find((h) => h.canHandle(state.step));
      if (handler) {
        await handler.execute(fromNumber, message, state);
      } else {
        await this.stateService.clearState(fromNumber);
        await this.metaWhatsappService.sendMessage(
          fromNumber,
          'Lo siento, no entendí eso. Escribe "Hola" para reiniciar.',
        );
      }
    } catch (error) {
      this.logger.error('Error handling incoming message:', error);
    }
  }

  private extractMessage(body: WebhookBody): MetaMessage | null {
    return body.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || null;
  }

  private extractStatus(body: WebhookBody): MetaStatus | null {
    return body.entry?.[0]?.changes?.[0]?.value?.statuses?.[0] || null;
  }

  private extractText(message: MetaMessage): string {
    if (message.text?.body) return message.text.body.trim();
    if (message.interactive?.button_reply?.id) return message.interactive.button_reply.id;
    return '';
  }

  private async handleGreeting(phone: string) {
    await this.stateService.setState(phone, { step: Steps.AWAITING_NAME });
    await this.metaWhatsappService.sendInteractiveMessage(
      phone,
      '¡Hola! Soy Helena de SIRCA Plan de Salud. ✨ Qué gusto saludarte, ¿en qué puedo apoyarte hoy?',
      [
        { type: 'reply', reply: { id: 'info_planes', title: 'Ver planes 📋' } },
        { type: 'reply', reply: { id: 'realizar_pago', title: 'Pagar mi Plan 💳' } },
      ],
    );
  }
  private async handleStatusError(status: MetaStatus) {
    const recipientId = status.recipient_id;

    const recipientState: UserState | null = await this.stateService.getState(recipientId);

    // Only initiate manual fallback if we specifically failed to send/deliver the Flow message
    if (recipientState?.step === 'AWAITING_FLOW_INTERACTION') {
      this.logger.warn(
        `Flow message delivery failed for ${recipientId}. Initiating manual flow fallback.`,
      );
      await this.stateService.setState(recipientId, { step: Steps.AWAITING_DOC_INFO_MANUAL });
      await this.metaWhatsappService.sendMessage(
        recipientId,
        'Tuvimos problemas para enviar o abrir el formulario seguro en tu dispositivo. Continuaremos con el proceso por aquí.\n\nPor favor, ingresa tu tipo y número de documento (Ejemplo: V-1234567).',
      );
    } else {
      this.logger.error(`Message delivery failed for ${recipientId}. Errors:`, status.errors);
    }
  }

  private async handleFlowCompletion(
    phone: string,
    message: MetaMessage,
    state: UserState,
  ): Promise<void> {
    try {
      // Extraemos el JSON que devuelve el formulario de Meta al completarse
      const flowData = JSON.parse(message.interactive!.nfm_reply!.response_json);

      // Mapeamos la respuesta del flujo a nuestro estado
      const updatedState: UserState = {
        ...state,
        step: Steps.AWAITING_CAPTURE,
        selected_invoices: flowData.selected_invoices,
        payment_method: flowData.payment_method,
        total_amount: flowData.total_amount,
        identity_card: flowData.doc_number || undefined,
        type_identity_card: flowData.doc_type || undefined,
      };

      await this.stateService.setState(phone, updatedState);

      await this.metaWhatsappService.sendMessage(
        phone,
        '¡Perfecto! Para completar tu registro, por favor envíame por aquí una captura o foto de tu comprobante de pago. ✨',
      );
    } catch (e) {
      this.logger.error('Error parsing flow response', e);
      // Aquí podrías decidir si mandas un mensaje de error al usuario o lo dejas como está
    }
  }

  private async initPaymentFlow(phone: string, state: UserState): Promise<void> {
    const success = await this.metaWhatsappService.sendFlowMessage(
      phone,
      '¡Perfecto! Para que sea más rápido, he preparado un pequeño formulario aquí mismo. Haz clic abajo para completar tus datos de pago de forma segura. ✨',
    );

    if (!success) {
      // If flow sending synchronously fails, transition automatically
      state = { step: Steps.AWAITING_DOC_INFO_MANUAL };
      await this.stateService.setState(phone, state);
      await this.metaWhatsappService.sendMessage(
        phone,
        'Tuvimos problemas para iniciar el formulario seguro. Continuaremos con el proceso por aquí.\n\nPor favor, ingresa tu tipo y número de documento (Ejemplo: V-1234567).',
      );
    } else {
      // Await flow interaction or a webhook failure status
      state = { step: Steps.AWAITING_FLOW_INTERACTION };
      await this.stateService.setState(phone, state);
    }
  }
}
