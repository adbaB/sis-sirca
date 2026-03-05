import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as twilio from 'twilio';
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

  async handleIncomingMessage(body: any): Promise<string> {
    const fromNumber = body.From;
    const incomingText = body.Body ? body.Body.trim() : '';
    const numMedia = parseInt(body.NumMedia || '0');

    const twiml = new twilio.twiml.MessagingResponse();
    let state = this.stateStore.get(fromNumber);

    // If no state or user wants to restart, initialize state.
    if (!state || incomingText.toLowerCase() === 'hola' || incomingText.toLowerCase() === 'reiniciar') {
      state = { step: 'AWAITING_NAME' };
      this.stateStore.set(fromNumber, state);
      twiml.message('¡Hola! Soy Elena, tu asistente virtual de SIRCA Seguros. Para procesar tu pago, ¿podrías indicarme tu nombre completo?');
      return twiml.toString();
    }

    switch (state.step) {
      case 'AWAITING_NAME':
        if (!incomingText) {
          twiml.message('Por favor, indícame tu nombre completo.');
          return twiml.toString();
        }
        state.name = incomingText;
        state.step = 'AWAITING_EMAIL';
        this.stateStore.set(fromNumber, state);
        twiml.message(`Gracias ${state.name}. Ahora, por favor ingresa tu correo electrónico.`);
        break;

      case 'AWAITING_EMAIL':
        if (!incomingText || !incomingText.includes('@')) {
          twiml.message('Por favor, ingresa un correo electrónico válido.');
          return twiml.toString();
        }
        state.email = incomingText;
        state.step = 'AWAITING_RECEIPT';
        this.stateStore.set(fromNumber, state);
        twiml.message('¡Excelente! Finalmente, por favor envíame una imagen o foto de tu comprobante de pago.');
        break;

      case 'AWAITING_RECEIPT':
        if (numMedia > 0) {
          // Process the first attached media
          const mediaUrl = body.MediaUrl0;
          const contentType = body.MediaContentType0 || 'image/jpeg';

          try {
            twiml.message('Estamos procesando tu comprobante, un momento por favor...');

            // Note: Downloading Twilio media may require HTTP basic auth
            // if the media is protected, using Account Sid and Auth Token.
            // WhatsApp media URLs are generally accessible for a short period.
            const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
            const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

            const auth = accountSid && authToken ? { username: accountSid, password: authToken } : undefined;

            const response = await axios.get(mediaUrl, {
              responseType: 'arraybuffer',
              auth
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

            twiml.message('¡Comprobante recibido y procesado con éxito! Hemos enviado un correo con la confirmación. Gracias por confiar en SIRCA Seguros.');
          } catch (error) {
            this.logger.error('Error processing media:', error);
            twiml.message('Hubo un error al procesar tu comprobante. Por favor, intenta enviarlo de nuevo.');
          }
        } else {
          twiml.message('Aún no he recibido ninguna imagen. Por favor, adjunta tu comprobante de pago.');
        }
        break;

      default:
        this.stateStore.delete(fromNumber);
        twiml.message('Lo siento, no entendí eso. Escribe "Hola" para reiniciar.');
        break;
    }

    return twiml.toString();
  }
}
