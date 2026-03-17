import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Tesseract from 'tesseract.js';
import OpenAI from 'openai';

export interface ReceiptData {
  monto: string | null;
  referencia: string | null;
  beneficiario: string | null;
  bancoDestino: string | null;
  fecha: string | null;
  origen: string | null;
  descripcion: string | null;
  nombreBanco: string | null;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('config.openrouter.apiKey');

    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey || 'dummy-key-for-tests', // fallback
    });
  }

  async extractReceiptData(imageBufferOrUrl: string | Buffer): Promise<ReceiptData> {
    try {
      this.logger.log('Starting OCR extraction with Tesseract...');
      const { data: { text } } = await Tesseract.recognize(
        imageBufferOrUrl as any,
        'spa', // Spanish language by default for receipts
      );

      this.logger.log('OCR text extracted successfully. Sending to OpenRouter (OpenAI)...');

      const prompt = `
        A continuación se muestra el texto extraído de un recibo de pago mediante OCR.
        Tu tarea es extraer los siguientes datos y devolver ÚNICAMENTE un objeto JSON válido, sin formato adicional, markdown ni texto explicativo. Si no encuentras algún dato, usa null.

        Datos a extraer:
        - monto
        - referencia
        - beneficiario
        - bancoDestino
        - fecha
        - origen
        - descripcion
        - nombreBanco

        Texto del recibo:
        """
        ${text}
        """
      `;

      const completion = await this.openai.chat.completions.create({
        model: 'openai/gpt-4o-mini', // or any preferred model available in OpenRouter
        messages: [
          {
            role: 'system',
            content: 'Eres un asistente experto en analizar recibos de pago y extraer datos en formato JSON puro. No uses bloques de código markdown.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        // response_format: { type: 'json_object' }, // Supported by many OpenRouter models
        temperature: 0,
      });

      let responseContent = completion.choices[0]?.message?.content || '{}';

      // Clean up markdown code blocks if the AI still adds them
      responseContent = responseContent.replace(/```json/g, '').replace(/```/g, '').trim();

      const parsedData: ReceiptData = JSON.parse(responseContent);
      return parsedData;
    } catch (error) {
      this.logger.error('Error processing receipt:', error);
      throw new Error('Failed to extract receipt data');
    }
  }
}
