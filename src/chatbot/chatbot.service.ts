import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { OcrService } from '../ocr/ocr.service';
import { BillingService } from '../billing/services/billing.service';
import { FlowsCryptoUtil } from './utils/flows-crypto.util';

interface UserState {
  step:
    | 'AWAITING_NAME'
    | 'AWAITING_EMAIL'
    | 'AWAITING_RECEIPT'
    | 'AWAITING_CAPTURE'
    | 'AWAITING_CONFIRMATION'
    | 'AWAITING_MANUAL_INPUT'
    | 'AWAITING_FLOW_INTERACTION'
    | 'AWAITING_DOC_INFO_MANUAL'
    | 'AWAITING_INVOICE_SELECTION_MANUAL'
    | 'AWAITING_PAYMENT_METHOD_MANUAL';
  name?: string;
  email?: string;
  selected_invoices?: string[];
  selected_invoices_details?: Array<{ id: string; amount: number }>;
  pending_invoices?: Array<{ id: string; title: string; description: string; amount: number }>;
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
    private configService: ConfigService,
    private awsService: AwsService,
    private emailService: EmailService,
    private ocrService: OcrService,
    private billingService: BillingService,
  ) {}

  private async sendMessage(to: string, text: string): Promise<void> {
    const accessToken = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneNumberId = this.configService.get<string>('META_PHONE_NUMBER_ID');

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
    const accessToken = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneNumberId = this.configService.get<string>('META_PHONE_NUMBER_ID');

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

  private async sendFlowMessage(to: string, text: string): Promise<boolean> {
    const accessToken = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneNumberId = this.configService.get<string>('META_PHONE_NUMBER_ID');
    const flowId = this.configService.get<string>('META_FLOW_ID');

    if (!accessToken || !phoneNumberId || !flowId) {
      this.logger.error('Missing Meta access token, phone number ID or flow ID in configuration.');
      return false;
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
                flow_message_version: '3',
                flow_token: 'payment_flow_token',
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
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending flow message to ${to}:`,
        error?.response?.data || error.message,
      );
      return false;
    }
  }

  async handleEncryptedFlowDataExchange(body: {
    encrypted_aes_key: string;
    encrypted_flow_data: string;
    initial_vector: string;
  }): Promise<string> {
    const privateKey = this.configService.get<string>('config.meta.flowPrivateKey');
    const passphrase = this.configService.get<string>('config.meta.flowPassphrase');

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
          description: `Contrato ${inv.contract?.code} - Monto: ${Number(inv.totalAmount) - Number(inv.paidAmount)}`,
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
          statuses?: Array<{
            status: string;
            recipient_id: string;
            errors?: Array<{
              code: number;
              title: string;
            }>;
          }>;
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

      const statusObj = value?.statuses?.[0];
      const message = value?.messages?.[0];

      if (statusObj && statusObj.status === 'failed' && statusObj.errors) {
        const recipientId = statusObj.recipient_id;
        const recipientState = this.stateStore.get(recipientId);

        // Only initiate manual fallback if we specifically failed to send/deliver the Flow message
        if (recipientState?.step === 'AWAITING_FLOW_INTERACTION') {
          this.logger.warn(`Flow message delivery failed for ${recipientId}. Initiating manual flow fallback.`);
          this.stateStore.set(recipientId, { step: 'AWAITING_DOC_INFO_MANUAL' });
          await this.sendMessage(
            recipientId,
            'Tuvimos problemas para enviar o abrir el formulario seguro en tu dispositivo. Continuaremos con el proceso por aquí.\n\nPor favor, ingresa tu tipo y número de documento (Ejemplo: V-1234567).',
          );
        } else {
          this.logger.error(`Message delivery failed for ${recipientId}. Errors:`, statusObj.errors);
        }
        return;
      }

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
        incomingText?.toLowerCase() === 'hola' ||
        incomingText?.toLowerCase() === 'reiniciar'
      ) {
        state = { step: 'AWAITING_NAME' };
        this.stateStore.delete(fromNumber); // Reset

        const buttons = [
          { type: 'reply', reply: { id: 'info_planes', title: '1. Info de planes' } },
          { type: 'reply', reply: { id: 'realizar_pago', title: '2. Realizar pago' } },
        ];

        await this.sendInteractiveMessage(
          fromNumber,
          '¡Hola! Soy Helena, tu asistente virtual de SIRCA Seguros. ¿En qué puedo ayudarte hoy?',
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
            'Por favor, envía la imagen del comprobante de pago (capture) por aquí.',
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
          'Para información sobre nuestros planes, por favor contacta a nuestro asesor comercial:\n\n📱 WhatsApp: +58 414-XXXXXXX\n📧 Correo: ventas@sirca.com',
        );
        this.stateStore.delete(fromNumber);
        return;
      }

      if (incomingText === 'realizar_pago') {
        const success = await this.sendFlowMessage(
          fromNumber,
          'Haz clic en el botón de abajo para iniciar el proceso de pago seguro.',
        );

        if (!success) {
          // If flow sending synchronously fails, transition automatically
          state = { step: 'AWAITING_DOC_INFO_MANUAL' };
          this.stateStore.set(fromNumber, state);
          await this.sendMessage(
            fromNumber,
            'Tuvimos problemas para iniciar el formulario seguro. Continuaremos con el proceso por aquí.\n\nPor favor, ingresa tu tipo y número de documento (Ejemplo: V-1234567).',
          );
        } else {
          // Await flow interaction or a webhook failure status
          state = { step: 'AWAITING_FLOW_INTERACTION' };
          this.stateStore.set(fromNumber, state);
        }
        return;
      }

      switch (state.step) {
        case 'AWAITING_CAPTURE':
          if (mediaId) {
            try {
              await this.sendMessage(
                fromNumber,
                'Estamos procesando tu comprobante, un momento por favor...',
              );

              const accessToken = this.configService.get<string>('META_ACCESS_TOKEN');

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
                  `Hemos detectado los siguientes datos de tu pago:\n\nReferencia: ${extractedData.referencia || 'No detectada'}\nMonto: ${extractedData.monto || 'No detectado'}\nBanco: ${extractedData.nombreBanco || 'No detectado'}\n\n¿Son correctos?`,
                  buttons,
                );
              } catch (ocrError) {
                this.logger.error('OCR Error', ocrError);
                state.step = 'AWAITING_MANUAL_INPUT';
                this.stateStore.set(fromNumber, state);
                await this.sendMessage(
                  fromNumber,
                  'No pudimos extraer los datos del comprobante automáticamente. Por favor, escribe los datos manualmente en el siguiente formato:\n\nReferencia, Banco, Monto',
                );
              }
            } catch (error) {
              this.logger.error('Error processing media:', error?.response?.data || error.message);
              await this.sendMessage(
                fromNumber,
                'Hubo un error al procesar tu comprobante. Por favor, intenta enviarlo de nuevo.',
              );
            }
          } else {
            await this.sendMessage(
              fromNumber,
              'Aún no he recibido ninguna imagen. Por favor, adjunta tu comprobante de pago (capture).',
            );
          }
          break;

        case 'AWAITING_CONFIRMATION':
          if (incomingText === 'datos_correctos') {
            // Create payment
            try {
              if (state.selected_invoices_details && state.selected_invoices_details.length > 0) {
                for (const invoice of state.selected_invoices_details) {
                  await this.billingService.createPayment({
                    invoiceId: invoice.id,
                    amount: invoice.amount,
                    paymentMethod: state.payment_method || 'transferencia',
                    referenceNumber: (state.extracted_data?.referencia as string) || 'N/A',
                  });
                }
              } else if (state.selected_invoices && state.selected_invoices.length > 0) {
                // Fallback for flows that only sent IDs
                const splitAmount = (Number(state.total_amount) || 0) / state.selected_invoices.length;
                for (const invoiceId of state.selected_invoices) {
                  await this.billingService.createPayment({
                    invoiceId: invoiceId,
                    amount: splitAmount,
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
                '¡Tu pago ha sido registrado exitosamente! Hemos notificado a nuestro equipo administrativo. Gracias por confiar en SIRCA Seguros.',
              );
            } catch (e) {
              this.logger.error('Error saving payment', e);
              await this.sendMessage(
                fromNumber,
                'Hubo un error al guardar tu pago. Por favor contacta soporte.',
              );
            }
          } else if (incomingText === 'datos_incorrectos') {
            state.step = 'AWAITING_MANUAL_INPUT';
            this.stateStore.set(fromNumber, state);
            await this.sendMessage(
              fromNumber,
              'Por favor, escribe los datos de tu pago en el siguiente formato, separados por comas:\n\nReferencia, Banco, Monto\n\nEjemplo: 123456, Mercantil, 100',
            );
          }
          break;

        case 'AWAITING_MANUAL_INPUT': {
          if (!incomingText || !incomingText.includes(',')) {
            await this.sendMessage(
              fromNumber,
              'Formato inválido. Por favor, usa el formato: Referencia, Banco, Monto\nEjemplo: 123456, Mercantil, 100',
            );
            return;
          }

          const parts = incomingText.split(',').map((s) => s.trim());
          const ref = parts[0] || 'N/A';
          const amount = parts[2] ? Number(parts[2]) : Number(state.total_amount);

          try {
            if (state.selected_invoices_details && state.selected_invoices_details.length > 0) {
               // If the user manually provided a total amount, proportionally split it based on their original invoices.
               // Otherwise, use the original exact invoice amounts.
               const manuallyAdjusted = parts[2] !== undefined;
               const ratio = manuallyAdjusted ? amount / (Number(state.total_amount) || 1) : 1;

               for (const invoice of state.selected_invoices_details) {
                  await this.billingService.createPayment({
                    invoiceId: invoice.id,
                    amount: manuallyAdjusted ? invoice.amount * ratio : invoice.amount,
                    paymentMethod: state.payment_method || 'transferencia',
                    referenceNumber: ref,
                  });
                }
            } else if (state.selected_invoices && state.selected_invoices.length > 0) {
              const splitAmount = amount / state.selected_invoices.length;
              for (const invoiceId of state.selected_invoices) {
                await this.billingService.createPayment({
                  invoiceId: invoiceId,
                  amount: splitAmount,
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
              '¡Tu pago ha sido registrado exitosamente! Hemos notificado a nuestro equipo administrativo. Gracias por confiar en SIRCA Seguros.',
            );
          } catch (e) {
            this.logger.error('Error saving payment manual', e);
            await this.sendMessage(
              fromNumber,
              'Hubo un error al guardar tu pago. Por favor contacta soporte.',
            );
          }
          break;
        }

        case 'AWAITING_FLOW_INTERACTION':
          // If the user sends any text while we are waiting for the Flow to open (e.g. they couldn't open it),
          // transition them to the manual flow immediately.
          if (incomingText) {
            state.step = 'AWAITING_DOC_INFO_MANUAL';
            this.stateStore.set(fromNumber, state);
            await this.sendMessage(
              fromNumber,
              'Parece que tuviste problemas con el formulario. Continuaremos con el proceso por aquí.\n\nPor favor, ingresa tu tipo y número de documento (Ejemplo: V-1234567).',
            );
          }
          break;

        case 'AWAITING_DOC_INFO_MANUAL': {
          if (!incomingText) {
            await this.sendMessage(fromNumber, 'Por favor, envía texto con tu tipo y número de documento.');
            return;
          }
          const docMatch = incomingText.match(/^([VvEeJjGg])[-]*(\d+)$/);
          if (!docMatch) {
            await this.sendMessage(
              fromNumber,
              'Formato inválido. Por favor ingresa el documento en este formato: V-1234567',
            );
            return;
          }

          const docType = docMatch[1].toUpperCase();
          const docNumber = docMatch[2];
          const identityCard = `${docType}-${docNumber}`;

          try {
            const invoices =
              await this.billingService.findPendingInvoicesByIdentityCard(identityCard);

            if (!invoices || invoices.length === 0) {
              await this.sendMessage(
                fromNumber,
                'No se encontraron facturas pendientes para este documento. Escribe "Hola" para reiniciar.',
              );
              this.stateStore.delete(fromNumber);
              return;
            }

            const pendingInvoices = invoices.map((inv) => ({
              id: inv.id,
              title: `Factura ${inv.billingMonth}`,
              description: `Contrato ${inv.contract?.code} - Monto: ${Number(inv.totalAmount) - Number(inv.paidAmount)}`,
              amount: Number(inv.totalAmount) - Number(inv.paidAmount),
            }));

            state.step = 'AWAITING_INVOICE_SELECTION_MANUAL';
            state.pending_invoices = pendingInvoices;
            this.stateStore.set(fromNumber, state);

            let invoiceText = 'Hemos encontrado las siguientes facturas pendientes:\n\n';
            pendingInvoices.forEach((inv, index) => {
              invoiceText += `${index + 1}. ${inv.title} - ${inv.description}\n`;
            });
            invoiceText +=
              '\nPor favor, responde con los números de las facturas que deseas pagar, separados por comas (Ejemplo: 1, 2).';

            await this.sendMessage(fromNumber, invoiceText);
          } catch (error) {
            this.logger.error('Error fetching invoices manually', error);
            await this.sendMessage(fromNumber, 'Hubo un error al buscar tus facturas. Inténtalo más tarde.');
            this.stateStore.delete(fromNumber);
          }
          break;
        }

        case 'AWAITING_INVOICE_SELECTION_MANUAL': {
          if (!incomingText) {
            await this.sendMessage(fromNumber, 'Por favor, responde con los números de las facturas.');
            return;
          }
          // Deduplicate the choices to prevent double-charging for the same invoice selection (e.g. "1, 1")
          const selections = [...new Set(incomingText
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n)))];

          if (selections.length === 0 || !state.pending_invoices) {
            await this.sendMessage(
              fromNumber,
              'Selección inválida. Por favor, responde con los números de las facturas separados por comas.',
            );
            return;
          }

          const selectedInvoices: string[] = [];
          const selectedInvoicesDetails: Array<{ id: string; amount: number }> = [];
          let totalAmount = 0;

          for (const selection of selections) {
            const idx = selection - 1;
            if (idx >= 0 && idx < state.pending_invoices.length) {
              const inv = state.pending_invoices[idx];
              selectedInvoices.push(inv.id);
              selectedInvoicesDetails.push({ id: inv.id, amount: inv.amount });
              totalAmount += inv.amount;
            }
          }

          if (selectedInvoices.length === 0) {
            await this.sendMessage(
              fromNumber,
              'No ingresaste números de factura válidos. Inténtalo de nuevo.',
            );
            return;
          }

          state.step = 'AWAITING_PAYMENT_METHOD_MANUAL';
          state.selected_invoices = selectedInvoices;
          state.selected_invoices_details = selectedInvoicesDetails;
          state.total_amount = totalAmount.toFixed(2);
          this.stateStore.set(fromNumber, state);

          const buttons = [
            { type: 'reply', reply: { id: 'pm_transferencia', title: 'Transferencia' } },
            { type: 'reply', reply: { id: 'pm_pago_movil', title: 'Pago Móvil' } },
            { type: 'reply', reply: { id: 'pm_zelle', title: 'Zelle' } },
          ];

          await this.sendInteractiveMessage(
            fromNumber,
            `Has seleccionado ${selectedInvoices.length} factura(s).\nTotal a pagar: ${state.total_amount}\n\nSelecciona tu método de pago:`,
            buttons,
          );
          break;
        }

        case 'AWAITING_PAYMENT_METHOD_MANUAL': {
          if (!incomingText) {
            await this.sendMessage(fromNumber, 'Por favor, selecciona una opción válida usando los botones.');
            return;
          }
          let paymentMethodStr = '';
          let paymentInfo = '';

          if (incomingText === 'pm_transferencia' || incomingText.toLowerCase() === 'transferencia') {
            paymentMethodStr = 'transferencia';
            paymentInfo =
              'Banco: Mercantil\nCuenta: 0105-XXXX-XXXX-XXXX\nTitular: SIRCA Seguros\nRIF: J-XXXXXXX';
          } else if (incomingText === 'pm_pago_movil' || incomingText.toLowerCase() === 'pago movil') {
            paymentMethodStr = 'pago_movil';
            paymentInfo = 'Banco: Mercantil\nTeléfono: 0414-XXXXXXX\nRIF: J-XXXXXXX';
          } else if (incomingText === 'pm_zelle' || incomingText.toLowerCase() === 'zelle') {
            paymentMethodStr = 'zelle';
            paymentInfo = 'Zelle: pagos@sirca.com\nTitular: SIRCA Seguros';
          } else {
            await this.sendMessage(fromNumber, 'Por favor, selecciona una opción válida usando los botones.');
            return;
          }

          state.step = 'AWAITING_CAPTURE';
          state.payment_method = paymentMethodStr;
          this.stateStore.set(fromNumber, state);

          await this.sendMessage(
            fromNumber,
            `Aquí tienes los datos para tu pago:\n\n${paymentInfo}\n\nUna vez realizado el pago, por favor envía la imagen del comprobante (capture) por aquí.`,
          );
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
