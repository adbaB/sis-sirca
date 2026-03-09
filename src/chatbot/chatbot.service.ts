import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';

interface UserState {
  step: 'AWAITING_NAME' | 'AWAITING_EMAIL' | 'AWAITING_RECEIPT';
  name?: string;
  email?: string;
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
  ) {}

  private async sendMessage(to: string, text: string): Promise<void> {
    const accessToken = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneNumberId = this.configService.get<string>(
      'META_PHONE_NUMBER_ID',
    );

    if (!accessToken || !phoneNumberId) {
      this.logger.error(
        'Missing Meta access token or phone number ID in configuration.',
      );
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
      this.logger.error(
        `Error sending message to ${to}:`,
        error?.response?.data || error.message,
      );
    }
  }

  async handleIncomingMessage(body: any): Promise<void> {
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (!message) {
        return;
      }

      const fromNumber = message.from;
      const incomingText = message.text?.body ? message.text.body.trim() : '';

      const mediaId = message.image?.id || message.document?.id || null;
      const contentType =
        message.image?.mime_type || message.document?.mime_type || 'image/jpeg';

      let state = this.stateStore.get(fromNumber);

      // If no state or user wants to restart, initialize state.
      if (
        !state ||
        incomingText.toLowerCase() === 'hola' ||
        incomingText.toLowerCase() === 'reiniciar'
      ) {
        state = { step: 'AWAITING_NAME' };
        this.stateStore.set(fromNumber, state);
        await this.sendMessage(
          fromNumber,
          '¡Hola! Soy Elena, tu asistente virtual de SIRCA Seguros. Para procesar tu pago, ¿podrías indicarme tu nombre completo?',
        );
        return;
      }

      switch (state.step) {
        case 'AWAITING_NAME':
          if (!incomingText) {
            await this.sendMessage(
              fromNumber,
              'Por favor, indícame tu nombre completo.',
            );
            return;
          }
          state.name = incomingText;
          state.step = 'AWAITING_EMAIL';
          this.stateStore.set(fromNumber, state);
          await this.sendMessage(
            fromNumber,
            `Gracias ${state.name}. Ahora, por favor ingresa tu correo electrónico.`,
          );
          break;

        case 'AWAITING_EMAIL':
          if (!incomingText || !incomingText.includes('@')) {
            await this.sendMessage(
              fromNumber,
              'Por favor, ingresa un correo electrónico válido.',
            );
            return;
          }
          state.email = incomingText;
          state.step = 'AWAITING_RECEIPT';
          this.stateStore.set(fromNumber, state);
          await this.sendMessage(
            fromNumber,
            '¡Excelente! Finalmente, por favor envíame una imagen o foto de tu comprobante de pago.',
          );
          break;

        case 'AWAITING_RECEIPT':
          if (mediaId) {
            try {
              await this.sendMessage(
                fromNumber,
                'Estamos procesando tu comprobante, un momento por favor...',
              );

              const accessToken =
                this.configService.get<string>('META_ACCESS_TOKEN');

              // 1. Get media URL
              const mediaResponse = await axios.get(
                `https://graph.facebook.com/v18.0/${mediaId}`,
                {
                  headers: { Authorization: `Bearer ${accessToken}` },
                },
              );
              const mediaUrl = mediaResponse.data.url;

              // 2. Download media buffer
              const response = await axios.get(mediaUrl, {
                responseType: 'arraybuffer',
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const buffer = Buffer.from(response.data, 'binary');

              // Guess extension
              const ext = contentType.split('/')[1] || 'jpg';
              const originalname = `comprobante.${ext}`;

              // Upload to S3
              const receiptUrl = await this.awsService.uploadFile({
                buffer,
                originalname,
                mimetype: contentType,
              });

              // Send Email
              const userInfo = {
                name: state.name,
                email: state.email,
                phone: fromNumber,
              };

              await this.emailService.sendPaymentConfirmation(
                state.email,
                userInfo,
                receiptUrl,
              );

              // Clear state after success
              this.stateStore.delete(fromNumber);

              await this.sendMessage(
                fromNumber,
                '¡Comprobante recibido y procesado con éxito! Hemos enviado un correo con la confirmación. Gracias por confiar en SIRCA Seguros.',
              );
            } catch (error) {
              this.logger.error(
                'Error processing media:',
                error?.response?.data || error.message,
              );
              await this.sendMessage(
                fromNumber,
                'Hubo un error al procesar tu comprobante. Por favor, intenta enviarlo de nuevo.',
              );
            }
          } else {
            await this.sendMessage(
              fromNumber,
              'Aún no he recibido ninguna imagen. Por favor, adjunta tu comprobante de pago.',
            );
          }
          break;

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
