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
      if (!body.entry) return;
      for (const entry of body.entry) {
        if (!entry.changes) continue;
        for (const change of entry.changes) {
          const value = change.value;
          if (!value) continue;

          if (value.statuses) {
            for (const status of value.statuses) {
              if (status.status === 'failed' && status.errors) {
                await this.handleStatusError(status);
              }
            }
          }

          if (value.messages) {
            for (const message of value.messages) {
              await this.processMessage(message);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling incoming message:', error);
    }
  }

  private async processMessage(message: MetaMessage): Promise<void> {
    try {
      if (message.errors && message.errors.length > 0) {
        this.logger.error(`Received error inside message from Meta API:`, message.errors);
        return;
      }

      const fromNumber = message.from;
      const incomingText = this.extractText(message);

      let state: UserState | null = await this.stateService.getState(fromNumber);

      // ── PRIORITY: Flow completion (nfm_reply) ──
      // Process Flow responses BEFORE the greeting reset, so users coming
      // from notification templates (no prior state) don't lose their data.
      if (message.interactive?.nfm_reply) {
        if (!state) {
          state = { step: Steps.AWAITING_FLOW_INTERACTION };
        }
        return this.handleFlowCompletion(fromNumber, message, state);
      }

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

      const handler = this.stepHandlers.find((h) => h.canHandle(state!.step));
      if (handler) {
        // If the message has no text, no interactive reply, and no image, and it's not AWAITING_CAPTURE
        if (!incomingText && !message.image && state.step !== Steps.AWAITING_CAPTURE) {
          await this.metaWhatsappService.sendMessage(
            fromNumber,
            'Por favor, responde usando texto o las opciones del menú.',
          );
          return;
        }
        await handler.execute(fromNumber, message, state);
      } else {
        if (state.step === Steps.PROCESSING_PAYMENT) {
          return; // Ignore concurrent clicks while processing
        }
        await this.stateService.clearState(fromNumber);
        await this.metaWhatsappService.sendMessage(
          fromNumber,
          'Lo siento, no entendí eso. Escribe "Hola" para reiniciar.',
        );
      }
    } catch (e) {
      this.logger.error('Error processing individual message:', e);
    }
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
    if (
      recipientState?.step === 'AWAITING_FLOW_INTERACTION' &&
      recipientState.flow_message_id === status.id
    ) {
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
      await this.metaWhatsappService.sendMessage(
        phone,
        'Hubo un problema al procesar tu respuesta del formulario. Por favor, escribe "Hola" para reiniciar el proceso.',
      );
    }
  }

  private async initPaymentFlow(phone: string, state: UserState): Promise<void> {
    const messageId = await this.metaWhatsappService.sendFlowMessage(
      phone,
      '¡Perfecto! Para que sea más rápido, he preparado un pequeño formulario aquí mismo. Haz clic abajo para completar tus datos de pago de forma segura. ✨',
    );

    if (!messageId) {
      // If flow sending synchronously fails, transition automatically
      state = { step: Steps.AWAITING_DOC_INFO_MANUAL };
      await this.stateService.setState(phone, state);
      await this.metaWhatsappService.sendMessage(
        phone,
        'Tuvimos problemas para iniciar el formulario seguro. Continuaremos con el proceso por aquí.\n\nPor favor, ingresa tu tipo y número de documento (Ejemplo: V-1234567).',
      );
    } else {
      // Await flow interaction or a webhook failure status
      state = { step: Steps.AWAITING_FLOW_INTERACTION, flow_message_id: messageId };
      await this.stateService.setState(phone, state);
    }
  }
}
