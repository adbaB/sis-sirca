import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import OpenAI from 'openai';
import sharp from 'sharp';
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
        // Resize to max 1024px on the longest side before encoding.
        // This keeps the image readable for camera photos while capping the
        // number of vision tiles to ≤4, reducing cost from ~37k to ~765 tokens.
        const resizedBuffer = await sharp(imageBufferOrUrl)
          .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        const base64Image = resizedBuffer.toString('base64');
        imageUrl = `data:image/jpeg;base64,${base64Image}`;
      }

      this.logger.log('Sending image directly to OpenRouter (openai/gpt-4o-mini)...');

      const prompt = `
        Extrae los datos del comprobante de pago adjunto y devuelve ÚNICAMENTE un objeto JSON válido.

        Reglas críticas de formato:
        1. MONTO: Convierte el formato venezolano (decimal con coma) a formato numérico estándar (decimal con punto). Elimina puntos de miles. Ejemplo: "1.250,50" -> 1250.50.
        2. REFERENCIA: Extrae el número de referencia exacto, sin omitir dígitos, sin redondear y sin añadir espacios.
        3. CAMPOS VACÍOS: Usa null si el dato no es legible o no existe.
        4. Sin texto adicional, solo el JSON.

        Campos a extraer:
        {
          "monto": (number),
          "referencia": (string),
          "beneficiario": (string),
          "bancoDestino": (string),
          "fecha": (string),
          "origen": (string),
          "descripcion": (string),
          "nombreBanco": (string),
          "moneda": (string)
        }
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
                    // "high" detail reads the image in 512×512 tiles.
                    // Pre-resizing to max 1024px caps this at 4 tiles (~765 tokens total)
                    // instead of 37k+ tokens from a full-resolution camera photo.
                    detail: 'high',
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
