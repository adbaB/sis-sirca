import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import OpenAI from 'openai';
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
      this.logger.log('Preparing image for OpenRouter Vision model...');

      let imageUrl = '';
      if (typeof imageBufferOrUrl === 'string') {
        imageUrl = imageBufferOrUrl;
      } else {
        const base64Image = imageBufferOrUrl.toString('base64');
        imageUrl = `data:image/jpeg;base64,${base64Image}`;
      }

      this.logger.log('Sending image directly to OpenRouter (openai/gpt-4o-mini)...');

      const prompt = `
        A continuación se adjunta la foto de un comprobante de pago o recibo.
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
      `;

      const completion = await this.openai.chat.completions.create(
        {
          model: 'openai/gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'Eres un asistente experto en analizar recibos de pago a partir de imágenes y extraer datos en formato JSON puro. No uses bloques de código markdown.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl,
                  },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' }, // Supported by OpenAI models
          temperature: 0,
        },
        { timeout: 30_000 },
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
