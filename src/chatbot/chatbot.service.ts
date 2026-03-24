import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { AwsService } from '../aws/aws.service';
import { BillingService } from '../billing/services/billing.service';
import config from '../config/configurations';
import { EmailService } from '../email/email.service';
import { OcrService } from '../ocr/ocr.service';
import { FlowsCryptoUtil } from './utils/flows-crypto.util';

interface UserState {
  step:
    | 'AWAITING_NAME'
    | 'AWAITING_EMAIL'
    | 'AWAITING_RECEIPT'
    | 'AWAITING_CAPTURE'
    | 'AWAITING_CONFIRMATION'
    | 'AWAITING_MANUAL_INPUT';
  name?: string;
  email?: string;
  selected_invoices?: string[];
  payment_method?: string;
  total_amount?: string;
  extracted_data?: Record<string, unknown>;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  // In-memory state store mapped by phone number.
  // In production, consider using Redis or a Database.
  private stateStore = new Map<string, UserState>();

  constructor(
    @Inject(config.KEY)
    private readonly configService: ConfigType<typeof config>,
    private awsService: AwsService,
    private emailService: EmailService,
    private ocrService: OcrService,
    private billingService: BillingService,
  ) {}

  private async sendMessage(to: string, text: string): Promise<void> {
    const accessToken = this.configService.meta.accessToken;
    const phoneNumberId = this.configService.meta.phoneNumberId;

    if (!accessToken || !phoneNumberId) {
      this.logger.error('Missing Meta access token or phone number ID in configuration.');
      return;
    }

    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          text: { body: text },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      this.logger.error(`Error sending message to ${to}:`, error?.response?.data || error.message);
    }
  }

  private async sendInteractiveMessage(
    to: string,
    text: string,
    buttons: Array<{ type: string; reply: { id: string; title: string } }>,
  ): Promise<void> {
    const accessToken = this.configService.meta.accessToken;
    const phoneNumberId = this.configService.meta.phoneNumberId;

    if (!accessToken || !phoneNumberId) {
      this.logger.error('Missing Meta access token or phone number ID in configuration.');
      return;
    }

    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text },
            action: { buttons },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Error sending interactive message to ${to}:`,
        error?.response?.data || error.message,
      );
    }
  }

  private async sendFlowMessage(to: string, text: string): Promise<void> {
    const accessToken = this.configService.meta.accessToken;
    const phoneNumberId = this.configService.meta.phoneNumberId;
    const flowId = this.configService.meta.flowId;

    if (!accessToken || !phoneNumberId || !flowId) {
      this.logger.error('Missing Meta access token, phone number ID or flow ID in configuration.');
      return;
    }

    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: {
            type: 'flow',
            header: {
              type: 'text',
              text: 'Pago de Facturas',
            },
            body: {
              text,
            },
            footer: {
              text: 'Sirca Seguros',
            },
            action: {
              name: 'flow',
              parameters: {
                mode: 'draft',
                flow_message_version: '3',
                flow_token: crypto.randomUUID(),
                flow_id: flowId,
                flow_cta: 'Realizar pago',
                flow_action: 'navigate',
                flow_action_payload: {
                  screen: 'SCREEN_IDENTIFICATION',
                },
              },
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Error sending flow message to ${to}:`,
        error?.response?.data || error.message,
      );
    }
  }

  async handleEncryptedFlowDataExchange(body: {
    encrypted_aes_key: string;
    encrypted_flow_data: string;
    initial_vector: string;
  }): Promise<string> {
    const privateKey = this.configService.meta.flowPrivateKey;
    const passphrase = this.configService.meta.flowPassphrase;

    if (!privateKey) {
      this.logger.warn(
        'META_FLOW_PRIVATE_KEY not set. Flow Data Exchange cannot decrypt payload securely.',
      );
      throw new Error('Server not configured for secure Flow exchange.');
    }

    const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

    if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
      throw new Error('Missing encrypted data fields in request.');
    }

    try {
      const decryptedAesKey = FlowsCryptoUtil.decryptAesKey(
        encrypted_aes_key,
        privateKey,
        passphrase,
      );
      const decryptedPayload = FlowsCryptoUtil.decryptPayload(
        decryptedAesKey,
        encrypted_flow_data,
        initial_vector,
      );

      // Debug: Meta Flow Data Exchange a veces hace "checks" (handshake/health).
      // Logueamos lo mínimo para poder identificar la acción sin exponer payload completo.
      const action = (decryptedPayload as Record<string, unknown>)?.action as string | undefined;
      const data = ((decryptedPayload as Record<string, unknown>)?.data || {}) as Record<
        string,
        unknown
      >;
      const dataAction = data?.action as string | undefined;
      this.logger.log(
        `[FlowDataExchange] action=${action ?? 'undefined'} data.action=${dataAction ?? 'undefined'} dataKeys=${
          Object.keys(data).join(',') || 'none'
        }`,
      );

      const responseObj = await this.handleFlowDataExchange(decryptedPayload);

      const encryptedResponse = FlowsCryptoUtil.encryptResponse(
        responseObj,
        decryptedAesKey,
        initial_vector,
      );
      return encryptedResponse;
    } catch (e) {
      this.logger.error('Error decrypting or encrypting flow data exchange:', e);
      throw e;
    }
  }

  async handleFlowDataExchange(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = body?.action as string | undefined;
    const data = (body?.data || {}) as Record<string, unknown>;

    const normalizedAction = action?.toUpperCase();
    // Respuesta esperada para tests/health checks del Flow (evita caer en "Acción no reconocida").
    if (
      normalizedAction === 'CHECK' ||
      normalizedAction === 'PING' ||
      normalizedAction === 'STATUS' ||
      normalizedAction === 'VERIFICATION'
    ) {
      return {
        screen: 'SCREEN_IDENTIFICATION',
        data: {
          status: 'active',
        },
      };
    }

    if (action === 'INIT') {
      return {
        screen: 'SCREEN_IDENTIFICATION',
        data: {},
      };
    }

    if (action === 'data_exchange') {
      const payload = data as Record<string, unknown>;
      const exchangeAction = payload.action as string | undefined;

      if (exchangeAction === 'fetch_invoices') {
        const docType = payload.doc_type as string;
        const docNumber = payload.doc_number as string;
        const identityCard = `${docType}-${docNumber}`;

        const invoices = await this.billingService.findPendingInvoicesByIdentityCard(identityCard);

        if (!invoices || invoices.length === 0) {
          return {
            screen: 'SCREEN_IDENTIFICATION',
            data: {
              error: true,
              error_message: 'No se encontraron facturas pendientes para este documento.',
            },
          };
        }

        const mappedInvoices = invoices.map((inv) => ({
          id: inv.id,
          title: `Factura ${inv.billingMonth}`,
          description: `Monto pendiente: ${Number(inv.totalAmount) - Number(inv.paidAmount)}`,
        }));

        return {
          screen: 'SCREEN_INVOICES',
          data: {
            invoices: mappedInvoices,
          },
        };
      }

      if (exchangeAction === 'fetch_payment_details') {
        const selectedInvoiceIds = (payload.selected_invoices || []) as string[];
        const paymentMethod = payload.payment_method as string;

        if (selectedInvoiceIds.length === 0) {
          return {
            screen: 'SCREEN_INVOICES',
            data: {
              error: true,
              error_message: 'Debes seleccionar al menos una factura.',
            },
          };
        }

        const invoices = await this.billingService.findInvoicesByIds(selectedInvoiceIds);
        const totalAmount = invoices.reduce(
          (sum, inv) => sum + (Number(inv.totalAmount) - Number(inv.paidAmount)),
          0,
        );

        let paymentInfo = '';
        if (paymentMethod === 'transferencia') {
          paymentInfo =
            'Banco: Mercantil\nCuenta: 0105-XXXX-XXXX-XXXX\nTitular: SIRCA Seguros\nRIF: J-XXXXXXX';
        } else if (paymentMethod === 'pago_movil') {
          paymentInfo = 'Banco: Mercantil\nTeléfono: 0414-XXXXXXX\nRIF: J-XXXXXXX';
        } else if (paymentMethod === 'zelle') {
          paymentInfo = 'Zelle: pagos@sirca.com\nTitular: SIRCA Seguros';
        }

        return {
          screen: 'SCREEN_PAYMENT_DETAILS',
          data: {
            payment_info: paymentInfo,
            total_amount: totalAmount.toFixed(2),
            selected_invoices: selectedInvoiceIds,
            payment_method: paymentMethod,
          },
        };
      }
    }

    return {
      screen: 'SCREEN_IDENTIFICATION',
      data: {
        error: true,
        error_message: 'Acción no reconocida.',
      },
    };
  }

  async handleIncomingMessage(body: {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from: string;
            type?: string;
            text?: { body: string };
            image?: { id: string; mime_type: string };
            document?: { id: string; mime_type: string };
            interactive?: {
              type: string;
              nfm_reply?: {
                response_json: string;
                body: string;
                name: string;
              };
              button_reply?: {
                id: string;
                title: string;
              };
            };
          }>;
        };
      }>;
    }>;
  }): Promise<void> {
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (!message) {
        return;
      }

      const fromNumber = message.from;
      let incomingText = message.text?.body ? message.text.body.trim() : '';

      const mediaId = message.image?.id || message.document?.id || null;
      const contentType = message.image?.mime_type || message.document?.mime_type || 'image/jpeg';

      const interactiveType = message.interactive?.type;
      const buttonReplyId = message.interactive?.button_reply?.id;
      const nfmReply = message.interactive?.nfm_reply;

      if (interactiveType === 'button_reply' && buttonReplyId) {
        incomingText = buttonReplyId;
      }

      let state = this.stateStore.get(fromNumber);

      // If no state or user wants to restart, initialize state.
      if (
        !state ||
        incomingText.toLowerCase() === 'hola' ||
        incomingText.toLowerCase() === 'reiniciar'
      ) {
        state = { step: 'AWAITING_NAME' };
        this.stateStore.delete(fromNumber); // Reset

        const buttons = [
          { type: 'reply', reply: { id: 'info_planes', title: 'Ver planes 📋' } },
          { type: 'reply', reply: { id: 'realizar_pago', title: 'Pagar mi seguro 💳' } },
        ];

        await this.sendInteractiveMessage(
          fromNumber,
          '¡Hola! Soy Helena de SIRCA Seguros. ✨ Qué gusto saludarte, ¿en qué puedo apoyarte hoy?',
          buttons,
        );

        // Let's set the state to initialized after greeting to avoid repeated greetings
        this.stateStore.set(fromNumber, { step: 'AWAITING_NAME' });
        return;
      }

      // Handle Flow completion (nfm_reply)
      if (nfmReply) {
        try {
          const flowData = JSON.parse(nfmReply.response_json);
          state = {
            step: 'AWAITING_CAPTURE',
            selected_invoices: flowData.selected_invoices,
            payment_method: flowData.payment_method,
            total_amount: flowData.total_amount,
          };
          this.stateStore.set(fromNumber, state);
          await this.sendMessage(
            fromNumber,
            '¡Perfecto! Para completar tu registro, por favor envíame por aquí una captura o foto de tu comprobante de pago. ✨',
          );
          return;
        } catch (e) {
          this.logger.error('Error parsing flow response', e);
        }
      }

      // Handle Interactive button replies for the Main Menu
      if (incomingText === 'info_planes') {
        await this.sendMessage(
          fromNumber,
          '¡Claro! Te pongo en contacto con nuestro asesor comercial para que te dé todos los detalles de los planes. ✨\n\nÉl te espera por aquí:\n📱 *WhatsApp:* +58 412-1201012 (https://wa.me/584121201012)\n\n¡Seguro encontrará el plan ideal para ti! 😊',
        );
        this.stateStore.delete(fromNumber);
        return;
      }

      if (incomingText === 'realizar_pago') {
        await this.sendFlowMessage(
          fromNumber,
          '¡Perfecto! Para que sea más rápido, he preparado un pequeño formulario aquí mismo. Haz clic abajo para completar tus datos de pago de forma segura. ✨',
        );
        return;
      }

      switch (state.step) {
        case 'AWAITING_CAPTURE':
          if (mediaId) {
            try {
              await this.sendMessage(
                fromNumber,
                '¡Recibido! 📥 Dame tan solo un momento mientras valido los datos de tu comprobante. ¡Ya casi terminamos!',
              );

              const accessToken = this.configService.meta.accessToken;

              // 1. Get media URL
              const mediaResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const mediaUrl = mediaResponse.data.url;

              // 2. Download media buffer
              const response = await axios.get(mediaUrl, {
                responseType: 'arraybuffer',
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const buffer = Buffer.from(response.data, 'binary');

              // Upload to S3
              const ext = contentType.split('/')[1] || 'jpg';
              const originalname = `comprobante.${ext}`;
              const receiptUrl = await this.awsService.uploadFile({
                buffer,
                originalname,
                mimetype: contentType,
              });

              state.extracted_data = { receiptUrl };

              // Process OCR
              try {
                const extractedData = await this.ocrService.extractReceiptData(buffer);
                state.extracted_data = { ...state.extracted_data, ...extractedData };

                state.step = 'AWAITING_CONFIRMATION';
                this.stateStore.set(fromNumber, state);

                const buttons = [
                  { type: 'reply', reply: { id: 'datos_correctos', title: 'Sí, son correctos' } },
                  {
                    type: 'reply',
                    reply: { id: 'datos_incorrectos', title: 'No, ingresarlos manual' },
                  },
                ];

                await this.sendInteractiveMessage(
                  fromNumber,
                  `¡Listo! He revisado tu comprobante y esto es lo que encontré: ✨\n\n` +
                    `📝 *Referencia:* ${extractedData.referencia || 'No detectada'}\n` +
                    `💰 *Monto:* ${extractedData.monto || 'No detectado'}\n` +
                    `🏦 *Banco:* ${extractedData.nombreBanco || 'No detectado'}\n\n` +
                    `¿Me confirmas si los datos están correctos para continuar? 👍`,
                  buttons,
                );
              } catch (ocrError) {
                this.logger.error('OCR Error', ocrError);
                state.step = 'AWAITING_MANUAL_INPUT';
                this.stateStore.set(fromNumber, state);
                await this.sendMessage(
                  fromNumber,
                  '¡Uy! No logré leer todos los datos de tu comprobante automáticamente. 📝\n\n¿Podrías escribirlos tú mismo para avanzar? Usa este formato, por favor:\n\nReferencia, Banco, Monto\n\n*(Ejemplo: 123456, Mercantil, 100)*',
                );
              }
            } catch (error) {
              this.logger.error('Error processing media:', error?.response?.data || error.message);
              await this.sendMessage(
                fromNumber,
                '¡Lo siento! Hubo un pequeño problema al procesar la imagen de tu comprobante. 🔄\n\n¿Podrías intentar enviarla de nuevo? Asegúrate de que se vea clarito. ✨',
              );
            }
          } else {
            await this.sendMessage(
              fromNumber,
              'Aún no me ha llegado la imagen. 🧐\n\nRecuerda adjuntar la captura de tu comprobante de pago por aquí para que pueda ayudarte a registrarlo.',
            );
          }
          break;

        case 'AWAITING_CONFIRMATION':
          if (incomingText === 'datos_correctos') {
            // Create payment
            try {
              if (state.selected_invoices && state.selected_invoices.length > 0) {
                for (const invoiceId of state.selected_invoices) {
                  await this.billingService.createPayment({
                    invoiceId: invoiceId,
                    amount: Number(state.total_amount) || 0,
                    paymentMethod: state.payment_method || 'transferencia',
                    referenceNumber: (state.extracted_data?.referencia as string) || 'N/A',
                  });
                }
              }

              // Send email
              const userInfo = { name: 'Cliente', email: 'admin@sirca.com', phone: fromNumber };
              await this.emailService.sendPaymentConfirmation(
                'admin@sirca.com',
                userInfo,
                state.extracted_data?.receiptUrl as string,
              );

              this.stateStore.delete(fromNumber);
              await this.sendMessage(
                fromNumber,
                '¡Excelente noticia! 🎉 Tu pago ha sido registrado con éxito.\n\nYa notifiqué a nuestro equipo administrativo para que lo validen. ¡Gracias por confiar en SIRCA Seguros! Estás en buenas manos. ✨',
              );
            } catch (e) {
              this.logger.error('Error saving payment', e);
              await this.sendMessage(
                fromNumber,
                '¡Oh, no! Tuve un inconveniente al intentar guardar los datos de tu pago. 😰\n\nPor favor, contacta a nuestro equipo de soporte técnico para solucionarlo de inmediato. ¡Lamentamos las molestias!',
              );
            }
          } else if (incomingText === 'datos_incorrectos') {
            state.step = 'AWAITING_MANUAL_INPUT';
            this.stateStore.set(fromNumber, state);
            await this.sendMessage(
              fromNumber,
              'Para que el sistema lo reconozca rápido, por favor escribe los datos separados por comas, así: ✍️\n\nReferencia, Banco, Monto\n\n💡 Ejemplo: 123456, Mercantil, 100',
            );
          }
          break;

        case 'AWAITING_MANUAL_INPUT': {
          if (!incomingText || !incomingText.includes(',')) {
            await this.sendMessage(
              fromNumber,
              '¡Casi lo tenemos! Pero el formato no es el correcto. ✨\n\nInténtalo de nuevo así: Referencia, Banco, Monto\n(Por ejemplo: 123456, Mercantil, 100)',
            );
            return;
          }

          const parts = incomingText.split(',').map((s) => s.trim());
          const ref = parts[0] || 'N/A';
          const amount = parts[2] ? Number(parts[2]) : Number(state.total_amount);

          try {
            if (state.selected_invoices && state.selected_invoices.length > 0) {
              for (const invoiceId of state.selected_invoices) {
                await this.billingService.createPayment({
                  invoiceId: invoiceId,
                  amount: amount || 0,
                  paymentMethod: state.payment_method || 'transferencia',
                  referenceNumber: ref,
                });
              }
            }

            const userInfo = { name: 'Cliente', email: 'admin@sirca.com', phone: fromNumber };
            await this.emailService.sendPaymentConfirmation(
              'admin@sirca.com',
              userInfo,
              state.extracted_data?.receiptUrl as string,
            );

            this.stateStore.delete(fromNumber);
            await this.sendMessage(
              fromNumber,
              '¡Excelente noticia! 🎉 Tu pago ha sido registrado con éxito.\n\nYa notifiqué a nuestro equipo administrativo para que lo validen. ¡Gracias por confiar en SIRCA Seguros! Estás en buenas manos. ✨',
            );
          } catch (e) {
            this.logger.error('Error saving payment manual', e);
            await this.sendMessage(
              fromNumber,
              '¡Oh, no! Tuve un inconveniente al intentar guardar los datos de tu pago. 😰\n\nPor favor, contacta a nuestro equipo de soporte técnico para solucionarlo de inmediato. ¡Lamentamos las molestias!',
            );
          }
          break;
        }

        default:
          this.stateStore.delete(fromNumber);
          await this.sendMessage(
            fromNumber,
            'Lo siento, no entendí eso. Escribe "Hola" para reiniciar.',
          );
          break;
      }
    } catch (error) {
      this.logger.error('Error handling incoming message:', error);
    }
  }
}
