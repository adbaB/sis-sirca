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
        // Prefer URLs to avoid base64 token overhead (~37k tokens vs ~1.4k tokens)
        imageUrl = imageBufferOrUrl;
      } else {
        this.logger.warn(
          'Received image as Buffer instead of URL. This will increase token usage significantly. Prefer passing a URL.',
        );
        const base64Image = imageBufferOrUrl.toString('base64');
        imageUrl = `data:image/jpeg;base64,${base64Image}`;
      }

      this.logger.log('Sending image to OpenRouter (openai/gpt-4o)...');

      const prompt = `Extrae los datos del comprobante de pago adjunto. Puede ser una transferencia bancaria venezolana O un pago Zelle desde un banco estadounidense.

INSTRUCCIONES PARA LA REFERENCIA:
1. Busca la referencia bajo etiquetas como: "Referencia:", "Nro. de referencia:", "Número de operación", "El número de operación es:", "Comprobante Nro", "Ref:", "N° Referencia", "Confirmation", "Confirmación", "Número de confirmación", "Reference Number".
2. La referencia puede ser NUMÉRICA (bancos venezolanos, ej: 000080329301) o ALFANUMÉRICA (Zelle, ej: WFCT128RS4V9, sa845yhrn, l0pxs6yl0).
3. Transcribe CADA CARÁCTER exactamente como aparece, respetando mayúsculas/minúsculas.
4. CONSERVA todos los ceros iniciales (ejemplo: 000080329301, NO 80329301).
5. NO confundas caracteres visualmente similares: 0/O, 1/l/I, 5/S, 8/B.
6. Si la referencia está parcialmente cortada o no es completamente visible, devuelve null.
7. IGNORA íconos de copiar/pegar que puedan aparecer junto a la referencia.

INSTRUCCIONES PARA EL MONTO:
- Formato venezolano: "1.250,50" → 1250.50 (elimina puntos de miles, coma decimal se convierte en punto).
- Formato americano/Zelle: "$108.00" → 108.00 (ya usa punto decimal).
- Si ves "Bs.", "BS", "Bs" o "VES", la moneda es "VES".
- Si ves "$", "USD", "US$" o es un pago Zelle, la moneda es "USD".

INSTRUCCIONES PARA IDENTIFICAR EL BANCO ORIGEN (quien envía el pago):
Identifica el banco usando texto visible O por sus características visuales:

Bancos venezolanos:
- Mercantil: Fondo azul degradado, logo "Mercantil" con flecha azul, texto "Tu Tpago fue exitoso".
- Banco de Venezuela (BDV): Encabezado rojo/vinotinto, logo tricolor (amarillo/azul/rojo), texto "PagomóvilBDV", URL "banvenez.com".
- Banesco: Tema verde, logo circular verde, texto "Banesco".
- BNC (Banco Nacional de Crédito): Encabezado azul oscuro, logo "BNC" en blanco, texto en azul/blanco.
- Provincial (BBVA): Tema azul con detalles blancos, logo BBVA Provincial.
- Banco del Tesoro: Tema azul claro, logo con estrella.
- Bicentenario: Tema verde/dorado, logo con estrella.
- Bancaribe: Tema naranja/blanco.
- Banco Exterior: Tema azul, logo con "E".
- BOD (Banco Occidental de Descuento): Tema azul/blanco.
- Banco Plaza: Tema verde.
- BFC (Banco Fondo Común): Tema verde.
- Bancamiga: Tema azul/naranja.
- Banco Activo: Tema azul.
- Banplus: Tema verde/azul.

Bancos Zelle (estadounidenses):
- Bank of America: Logo con bandera roja/azul, texto "BANK OF AMERICA", comprobantes en español o inglés.
- Wells Fargo: Tema rojo/dorado, fondo verde oscuro en check, logo carreta, "Confirmación" con prefijo "WFCT".
- Chase: Tema azul, logo octágono azul, texto "Chase".
- Zelle (app directa): Tema morado/púrpura oscuro, logo "Z" con ondas, texto "Payment Sent", "Reference Number".
- Citi / Citibank: Tema azul, arco azul en logo.
- Capital One: Tema rojo/blanco.
- TD Bank: Tema verde.
- PNC Bank: Tema naranja/azul.
Si no puedes identificar el banco origen, devuelve null.

FORMATO DE SALIDA:
Devuelve ÚNICAMENTE un JSON válido sin markdown, sin texto adicional:
{
  "monto": (number|null),
  "referencia": (string|null) Exactamente como aparece, sin espacios,
  "beneficiario": (string|null) Nombre del beneficiario/receptor del pago,
  "bancoDestino": (string|null) Banco receptor del pago,
  "fecha": (string|null) formato DD/MM/YYYY,
  "origen": (string|null) Banco desde donde se realizó el pago (identificado por texto o logo),
  "descripcion": (string|null) Concepto o descripción del pago,
  "nombreBanco": (string|null) Nombre del banco que emitió el comprobante (mismo que origen),
  "moneda": (string|null) "VES" o "USD"
}`;

      const completion = await this.openai.chat.completions.create(
        {
          model: 'openai/gpt-4o',
          messages: [
            {
              role: 'system',
              content:
                'Eres un asistente experto en OCR de comprobantes de pago bancarios venezolanos y pagos Zelle de bancos estadounidenses. Conoces los logos, colores y diseños de todos estos bancos. Extraes datos en formato JSON puro. No uses bloques de código markdown.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl,
                    detail: 'high',
                  },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
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

      // Post-OCR validation: sanitize referencia
      let referencia = raw.referencia ?? null;
      if (referencia) {
        // Strip whitespace and special characters, but KEEP letters and digits
        // (Zelle references are alphanumeric, e.g. "WFCT128RS4V9", "sa845yhrn")
        referencia = referencia.replace(/[\s\-./]/g, '');
        // Validate reasonable length (4-20 characters for both numeric and alphanumeric references)
        if (referencia.length < 4 || referencia.length > 20) {
          this.logger.warn(
            `Reference "${referencia}" has unusual length (${referencia.length}). Setting to null.`,
          );
          referencia = null;
        }
      }

      const parsedData: ReceiptData = {
        monto: raw.monto ?? null,
        referencia,
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
