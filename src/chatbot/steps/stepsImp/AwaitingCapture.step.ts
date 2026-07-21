import { Injectable, Logger } from '@nestjs/common';
import { IStepHandler } from '../step-handler.interface';
import { Steps } from '../../enums/steps.enum';
import { UserState } from '../../interfaces/userState.interface';
import { MetaMessage } from '../../interfaces/webhook.interface';
import { MetaWhatsappService } from '../../services/meta-whatsapp.service';
import { OcrService } from '../../../ocr/ocr.service';
import axios from 'axios';
import { ChatbotStateService } from '../../services/chatbot-state.service';
import { AwsService } from '../../../aws/aws.service';

@Injectable()
export class AwaitingCaptureStep implements IStepHandler {
  private readonly logger = new Logger(AwaitingCaptureStep.name);

  constructor(
    private readonly metaWhatsappService: MetaWhatsappService,
    private readonly ocrService: OcrService,
    private readonly awsService: AwsService,
    private readonly stateService: ChatbotStateService,
  ) {}

  canHandle(step: Steps): boolean {
    return step === Steps.AWAITING_CAPTURE;
  }
  async execute(phone: string, message: MetaMessage, state: UserState): Promise<void> {
    const mediaId = message.image?.id || message.document?.id || null;
    const contentType = message.image?.mime_type || message.document?.mime_type || 'image/jpeg';
    if (mediaId) {
      try {
        await this.metaWhatsappService.sendMessage(
          phone,
          '📥 Dame tan solo un momento mientras valido los datos de tu comprobante. ¡Ya casi terminamos!',
        );

        const buffer = await this.metaWhatsappService.downloadMedia(mediaId);
        // Upload to S3
        const receiptUrl = await this.uploadToS3(buffer, contentType);
        state.extracted_data = { receiptUrl };

        // Process OCR
        try {
          const extractedData = await this.ocrService.extractReceiptData(receiptUrl);
          state.extracted_data = { ...state.extracted_data, ...extractedData };

          state.step = Steps.AWAITING_CONFIRMATION;
          await this.stateService.setState(phone, state);

          const buttons = [
            { type: 'reply', reply: { id: 'datos_correctos', title: 'Sí, son correctos' } },
            {
              type: 'reply',
              reply: { id: 'datos_incorrectos', title: 'Ingreso manual' },
            },
          ];

          await this.metaWhatsappService.sendInteractiveMessage(
            phone,
            `He revisado tu comprobante y esto es lo que encontré: ✨\n\n📝 *Referencia:* ${extractedData.referencia || 'No detectada'}\n💰 *Monto:* ${extractedData.monto || 'No detectado'}${extractedData.moneda || ''}\n\n¿Me confirmas si los datos están correctos para continuar? 👍`,
            buttons,
          );
        } catch (ocrError) {
          this.logger.error('OCR Error', ocrError);
          state.step = Steps.AWAITING_MANUAL_INPUT;
          await this.stateService.setState(phone, state);
          await this.metaWhatsappService.sendMessage(
            phone,
            '¡Uy! No logré leer todos los datos de tu comprobante automáticamente. 📝\n\n¿Podrías escribirlos tú mismo para avanzar? Usa este formato, por favor:\n\nReferencia, Banco, Monto\n\n*(Ejemplo: 123456, Mercantil, 100)*',
          );
        }
      } catch (error) {
        let errorMsg: string;
        if (axios.isAxiosError(error)) {
          errorMsg = error.response?.data || error.message;
        } else {
          errorMsg = error instanceof Error ? error.message : String(error);
        }
        this.logger.error('Error processing media:', errorMsg);
        await this.metaWhatsappService.sendMessage(
          phone,
          '¡Lo siento! Hubo un pequeño problema al procesar la imagen de tu comprobante. 🔄\n\n¿Podrías intentar enviarla de nuevo? Asegúrate de que se vea clarito. ✨',
        );
      }
    } else {
      await this.metaWhatsappService.sendMessage(
        phone,
        'Aún no me ha llegado la imagen. 🧐\n\nRecuerda adjuntar la captura de tu comprobante de pago por aquí para que pueda ayudarte a registrarlo.',
      );
    }
  }

  private async uploadToS3(buffer: Buffer, contentType: string): Promise<string> {
    const ext = contentType.split('/')[1] || 'jpg';
    const originalname = `comprobante.${ext}`;
    const receiptUrl = await this.awsService.uploadFile({
      buffer,
      originalname,
      mimetype: contentType,
    });

    return receiptUrl;
  }
}
