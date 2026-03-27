import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import OpenAI from 'openai';
import * as Tesseract from 'tesseract.js';
import config from '../config/configurations';

export interface ReceiptData {
  monto: number | null;
  referencia: string | null;
  beneficiario: string | null;
  bancoDestino: string | null;
  fecha: string | null;
  origen: string | null;
  descripcion: string | null;
  nombreBanco: string | null;
  moneda?: string | null;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private openai: OpenAI;

  constructor(
    @Inject(config.KEY)
    private readonly configService: ConfigType<typeof config>,
  ) {
    const apiKey = this.configService.openrouter.apiKey;

    const isTestEnv = this.configService.env === 'test';

    if (!apiKey && !isTestEnv) {
      this.logger.warn(
        'Missing OPENROUTER_API_KEY in environment. OCR processing will fail if used.',
      );
    }

    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey ?? 'dummy-key-for-tests',
    });
  }

  async extractReceiptData(imageBufferOrUrl: string | Buffer): Promise<ReceiptData> {
    const apiKey = this.configService.openrouter.apiKey;
    const isTestEnv = this.configService.env === 'test';

    if (!apiKey && !isTestEnv) {
      throw new Error('Missing OPENROUTER_API_KEY. Cannot process OCR.');
    }

    try {
      this.logger.log('Starting OCR extraction with Tesseract...');
      const {
        data: { text },
      } = await Tesseract.recognize(
        imageBufferOrUrl,
        'spa', // Spanish language by default for receipts
      );

      this.logger.log('OCR text extracted successfully. Sending to OpenRouter (OpenAI)...');

      const prompt = `
        A continuación se muestra el texto extraído de un recibo de pago mediante OCR.
        Tu tarea es extraer los siguientes datos y devolver ÚNICAMENTE un objeto JSON válido, sin formato adicional, markdown ni texto explicativo. Si no encuentras algún dato, usa null.

        Datos a extraer:
        - monto (formato numérico, sin símbolos de moneda, e.g. 100.50)
        - referencia
        - beneficiario
        - bancoDestino
        - fecha
        - origen
        - descripcion
        - nombreBanco
        - moneda
        Texto del recibo:
        """
        ${text}
        """
      `;

      const completion = await this.openai.chat.completions.create(
        {
          model: 'deepseek/deepseek-v3.2', // or any preferred model available in OpenRouter
          messages: [
            {
              role: 'system',
              content:
                'Eres un asistente experto en analizar recibos de pago y extraer datos en formato JSON puro. No uses bloques de código markdown.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          response_format: { type: 'json_object' }, // Supported by many OpenRouter models
          temperature: 0,
        },
        { timeout: 15_000 },
      );

      let responseContent = completion.choices[0]?.message?.content || '{}';

      // Clean up markdown code blocks if the AI still adds them
      responseContent = responseContent
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      const raw = JSON.parse(responseContent) as Partial<ReceiptData>;

      const parsedData: ReceiptData = {
        monto: raw.monto ?? null,
        referencia: raw.referencia ?? null,
        beneficiario: raw.beneficiario ?? null,
        bancoDestino: raw.bancoDestino ?? null,
        fecha: raw.fecha ?? null,
        origen: raw.origen ?? null,
        descripcion: raw.descripcion ?? null,
        nombreBanco: raw.nombreBanco ?? null,
        moneda: raw.moneda ?? null,
      };
      return parsedData;
    } catch (error) {
      this.logger.error('Error processing receipt:', error);
      // @ts-expect-error ts(2554) underlying TS config doesn't support error cause yet
      throw new Error('Failed to extract receipt data', { cause: error });
    }
  }
}
