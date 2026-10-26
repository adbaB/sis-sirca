import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import OpenAI from 'openai';
import config from '../../config/configurations';
import { ConsumptionCategory } from '../entities/eventuality-extraction-detail.entity';

export interface ExtractedConsumptionItemResult {
  name: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  category: ConsumptionCategory;
  rawLineText?: string;
}

export interface ExtractedConsumptionSheetResult {
  currency: 'USD' | 'Bs';
  exchangeRate?: number | null;
  items: ExtractedConsumptionItemResult[];
  totalMedicamentos: number;
  totalMateriales: number;
  totalServicios: number;
  totalGeneral: number;
}

export interface ExtractedMedicalReportResult {
  reportType: string | null;
  company: string | null;
  doctorFullName: string | null;
  doctorIdentityCard: string | null;
  doctorMs: string | null;
  doctorComezu: string | null;
  doctorSpecialty: string | null;
  admissionDiagnosis: string | null;
  medicalReport: string | null;
  dischargeDiagnosis: string | null;
  reportDate: string | null;
  reportTime: string | null;
}

export interface ExtractedProviderInvoiceResult {
  providerName: string | null;
  providerRif: string | null;
  invoiceNumber: string | null;
  controlNumber: string | null;
  invoiceDate: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency?: 'USD' | 'Bs' | null;
}

@Injectable()
export class EventualityOcrService {
  private readonly logger = new Logger(EventualityOcrService.name);
  private openai: OpenAI;

  constructor(
    @Inject(config.KEY)
    private readonly configService: ConfigType<typeof config>,
  ) {
    const apiKey = this.configService.openrouter.apiKey;
    const isTestEnv = this.configService.env === 'test';

    if (!apiKey && !isTestEnv) {
      this.logger.warn(
        'Missing OPENROUTER_API_KEY. Eventuality OCR processing will fail in live environment.',
      );
    }

    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: apiKey ?? 'dummy-key-for-tests',
    });
  }

  /**
   * Extrae imágenes JPEG embebidas dentro de un buffer PDF escaneado (streams DCTDecode).
   * Permite enviar cada página escaneada en alta resolución (`detail: 'high'`) al modelo de visión.
   */
  private extractEmbeddedJpegsFromPdf(pdfBuffer: Buffer): Buffer[] {
    const jpegs: Buffer[] = [];
    let pos = 0;

    while (pos < pdfBuffer.length - 4) {
      if (pdfBuffer[pos] === 0xff && pdfBuffer[pos + 1] === 0xd8 && pdfBuffer[pos + 2] === 0xff) {
        const endStreamIdx = pdfBuffer.indexOf('endstream', pos);
        if (endStreamIdx !== -1) {
          let eoi = endStreamIdx - 1;
          while (eoi > pos && !(pdfBuffer[eoi - 1] === 0xff && pdfBuffer[eoi] === 0xd9)) {
            eoi--;
          }
          // Ignorar miniaturas muy pequeñas (< 5 KB) y conservar páginas reales
          if (eoi > pos && eoi + 1 - pos > 5_000) {
            jpegs.push(pdfBuffer.subarray(pos, eoi + 1));
            pos = eoi + 1;
            continue;
          }
        }
      }
      pos++;
    }

    return jpegs;
  }

  /**
   * Construye los bloques de contenido multimodal para OpenRouter/OpenAI:
   * - Si es un PDF escaneado con imágenes JPEG embebidas, extrae cada página como `image_url` (`detail: 'high'`).
   * - Si es un PDF digital sin JPEGs embebidos, usa `type: 'file'` con `file_data`.
   * - Si es una imagen, usa `type: 'image_url'`.
   */
  private buildMediaContentBlocks(
    source: string | Buffer,
    mimeType?: string,
    defaultFilename: string = 'document.pdf',
  ): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
    const normalizedMime = mimeType?.toLowerCase().trim() || '';
    const isPdfByMime = normalizedMime === 'application/pdf' || normalizedMime.endsWith('/pdf');
    const isPdfByUrl = typeof source === 'string' && /\.pdf($|\?)/i.test(source);
    const isPdfByMagicBytes =
      Buffer.isBuffer(source) &&
      source.length >= 5 &&
      source.subarray(0, 5).toString('ascii') === '%PDF-';

    if (isPdfByMime || isPdfByUrl || isPdfByMagicBytes) {
      if (Buffer.isBuffer(source)) {
        const embeddedJpegs = this.extractEmbeddedJpegsFromPdf(source);
        if (embeddedJpegs.length > 0) {
          return embeddedJpegs.map((jpg) => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:image/jpeg;base64,${jpg.toString('base64')}`,
              detail: 'high' as const,
            },
          }));
        }
      }

      const fileData =
        typeof source === 'string'
          ? source
          : `data:application/pdf;base64,${source.toString('base64')}`;

      return [
        {
          type: 'file',
          file: {
            filename: defaultFilename,
            file_data: fileData,
          },
        },
      ];
    }

    let imageUrl: string;
    if (typeof source === 'string') {
      imageUrl = source;
    } else {
      let resolvedImageMime = normalizedMime.startsWith('image/') ? normalizedMime : 'image/jpeg';
      if (!normalizedMime.startsWith('image/') && source.length >= 4) {
        if (source[0] === 0x89 && source[1] === 0x50 && source[2] === 0x4e && source[3] === 0x47) {
          resolvedImageMime = 'image/png';
        } else if (
          source[0] === 0x52 &&
          source[1] === 0x49 &&
          source[2] === 0x46 &&
          source[3] === 0x46
        ) {
          resolvedImageMime = 'image/webp';
        } else if (source[0] === 0x47 && source[1] === 0x49 && source[2] === 0x46) {
          resolvedImageMime = 'image/gif';
        }
      }
      imageUrl = `data:${resolvedImageMime};base64,${source.toString('base64')}`;
    }

    return [
      {
        type: 'image_url',
        image_url: {
          url: imageUrl,
          detail: 'high',
        },
      },
    ];
  }

  /**
   * Extrae y clasifica los insumos y costos desde una imagen, PDF o URL de hoja de consumo de clínica.
   */
  async extractConsumptionItems(
    imageUrlOrBuffer: string | Buffer,
    mimeType?: string,
  ): Promise<ExtractedConsumptionSheetResult> {
    const isTestEnv = this.configService.env === 'test';
    const apiKey = this.configService.openrouter.apiKey;

    if (!apiKey && !isTestEnv) {
      throw new Error('Missing OPENROUTER_API_KEY. Cannot process OCR.');
    }

    try {
      const mediaBlocks = this.buildMediaContentBlocks(
        imageUrlOrBuffer,
        mimeType,
        'consumption-sheet.pdf',
      );

      const prompt = `Analiza detalladamente esta hoja de consumo / cuenta médica de clínica o centro de salud venezolano.
Extrae todos los renglones facturados o consumidos y CLASIFICA CADA UNO exactamente en una de estas 3 áreas:
1. "MEDICAMENTO": fármacos, ampollas, pastillas, sueros, soluciones, analgésicos, antibióticos.
2. "MATERIAL": insumos descartables, inyectadoras, catéteres, gasas, guantes, adhesivos, tubos, apósitos.
3. "SERVICIO": derecho de sala de emergencia, honorarios de enfermería, monitoreo, días de cama, estudios o pruebas incluidas en la cuenta.

DETECCIÓN DE MONEDA ("USD" o "Bs"):
- Verifica en los encabezados de columna, subtotales o totales si los precios están expresados en Dólares ("$", "USD", "US$", "Divisas") o en Bolívares ("Bs", "Bs.", "Bs.S", "Bs.D", "VES", "Bolívares").
- Si la hoja de consumo muestra AMBAS columnas (Bolívares y Dólares), extrae los precios de la columna en DÓLARES y devuelve "currency": "USD".
- Si los precios de los renglones están expresados únicamente en Bolívares (o si no hay símbolo explícito pero los precios unitarios de insumos simples como jeringas, soluciones o ampollas están en cientos o miles, ej. 150.00, 480.00, 1250.00), devuelve "currency": "Bs".
- Si el documento indica explícitamente una tasa de cambio (ej. "Tasa BCV: 45.50", "Factor de cambio", "Tasa: ..."), extráela en "exchangeRate" como número decimal; de lo contrario devuelve null.

Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta estructura:
{
  "currency": "USD" | "Bs",
  "exchangeRate": 45.50 | null,
  "items": [
    {
      "name": "Nombre claro del ítem",
      "quantity": 1, // puede ser decimal (ej. 0.20, 0.50) si se trata de fracciones, ampollas o servicios parciales
      "unitCost": 10.50,
      "totalCost": 10.50,
      "category": "MEDICAMENTO" | "MATERIAL" | "SERVICIO",
      "rawLineText": "texto original de la línea si es visible"
    }
  ],
  "totalMedicamentos": 0.00,
  "totalMateriales": 0.00,
  "totalServicios": 0.00,
  "totalGeneral": 0.00
}

Reglas numéricas:
- Los costos deben ser números decimales en formato estándar (ej. 1250.50). Si vienen en formato venezolano (puntos de miles y coma decimal, ej. "1.250,50"), elimina los puntos de miles y convierte la coma en punto decimal (1250.50).
- La cantidad (quantity) puede ser un número decimal (ej. 0.20, 0.5, 1.5) si en el documento se indican dosis, fracciones de ampollas o servicios parciales. Si no puedes determinar la cantidad, usa 1.
- No agregues texto markdown antes ni después, únicamente el JSON.`;

      const response = await this.openai.chat.completions.create({
        model: 'anthropic/claude-sonnet-5.5',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }, ...mediaBlocks],
          },
        ],
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      const cleanJson = content
        .replace(/^```json\s*/i, '')
        .replace(/```$/i, '')
        .trim();

      const parsed = JSON.parse(cleanJson);

      const rawCurrency = String(parsed.currency || 'USD')
        .trim()
        .toUpperCase();
      const currency: 'USD' | 'Bs' =
        rawCurrency === 'BS' ||
        rawCurrency === 'BS.' ||
        rawCurrency === 'VES' ||
        rawCurrency === 'BOLIVARES'
          ? 'Bs'
          : 'USD';

      const parsedRate = Number(parsed.exchangeRate);
      const exchangeRate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null;

      const items: ExtractedConsumptionItemResult[] = (parsed.items || []).map(
        (it: {
          name?: string;
          quantity?: number;
          unitCost?: number;
          totalCost?: number;
          category?: string;
          rawLineText?: string;
        }) => {
          let cat: ConsumptionCategory = ConsumptionCategory.MATERIAL;
          const upperCat = (it.category || '').toUpperCase();
          if (upperCat === 'MEDICAMENTO') cat = ConsumptionCategory.MEDICAMENTO;
          else if (upperCat === 'SERVICIO') cat = ConsumptionCategory.SERVICIO;

          const parsedQty = Number(it.quantity);
          const qty =
            Number.isFinite(parsedQty) && parsedQty > 0 ? Number(parsedQty.toFixed(3)) : 1;
          const unit = Math.max(0, Number(it.unitCost || 0));
          const total = Number(it.totalCost || qty * unit);

          return {
            name: it.name || 'Insumo sin especificar',
            quantity: qty,
            unitCost: unit,
            totalCost: total,
            category: cat,
            rawLineText: it.rawLineText || undefined,
          };
        },
      );

      const totalMed = items
        .filter((i) => i.category === ConsumptionCategory.MEDICAMENTO)
        .reduce((sum, i) => sum + i.totalCost, 0);

      const totalMat = items
        .filter((i) => i.category === ConsumptionCategory.MATERIAL)
        .reduce((sum, i) => sum + i.totalCost, 0);

      const totalServ = items
        .filter((i) => i.category === ConsumptionCategory.SERVICIO)
        .reduce((sum, i) => sum + i.totalCost, 0);

      const totalGen = Number((totalMed + totalMat + totalServ).toFixed(2));

      return {
        currency,
        exchangeRate,
        items,
        totalMedicamentos: Number(totalMed.toFixed(2)),
        totalMateriales: Number(totalMat.toFixed(2)),
        totalServicios: Number(totalServ.toFixed(2)),
        totalGeneral: totalGen,
      };
    } catch (error) {
      this.logger.error('Error procesando hoja de consumo con IA:', error);
      throw error;
    }
  }

  /**
   * Extrae la información clínica y del médico tratante desde un informe médico (imagen o URL).
   */
  async extractMedicalReportData(
    imageUrlOrBuffer: string | Buffer,
    mimeType?: string,
  ): Promise<ExtractedMedicalReportResult> {
    const isTestEnv = this.configService.env === 'test';
    const apiKey = this.configService.openrouter.apiKey;

    if (!apiKey && !isTestEnv) {
      throw new Error('Missing OPENROUTER_API_KEY. Cannot process medical report OCR.');
    }

    try {
      const mediaBlocks = this.buildMediaContentBlocks(
        imageUrlOrBuffer,
        mimeType,
        'medical-report.pdf',
      );

      const prompt = `Extrae la información estructurada del informe médico adjunto (puede constar de una o varias páginas). Presta especial atención tanto a los campos impresos del formulario como al encabezado/membrete y al SELLO HÚMEDO o pie de firma del médico tratante.

INSTRUCCIONES POR CAMPO:
1. "reportType" (Tipo de informe médico):
   - Si el documento tiene una etiqueta explícita como "Tipo de Informe:" (ej: "Tipo de Informe: Egreso", "Emergencia", "Ingreso"), extrae exactamente ese valor (ej: "Egreso").
   - Si no tiene etiqueta "Tipo de Informe:", extrae el título del documento (ej: "Informe Médico", "Informe de Emergencia").

2. "company" (Empresa):
   - Si el documento tiene un campo explícito "Empresa:" (ej: "Empresa: SALUD INTEGRAL EL ROSARIO, C.A (SIRCA)"), extrae ese valor.
   - Si no existe el campo "Empresa:", extrae el nombre de la clínica, hospital o centro de salud del membrete/encabezado (ej: "Hospital El Rosario").

3. DATOS DEL MÉDICO TRATANTE (busca en la sección "DATOS DEL MÉDICO", en "FIRMA DEL MÉDICO" y dentro del SELLO HÚMEDO del médico; NO confundir con los datos del paciente):
   - "doctorFullName": Nombre y apellido completo del médico tratante (sin prefijos como "Dr." o "Dra.").
   - "doctorIdentityCard": Cédula de identidad del médico (bajo "Cédula de Identidad", "C.I.", "CI" del médico; NO coloques la cédula del paciente).
   - "doctorMs": Número o matrícula del Ministerio de Salud (bajo "MS:", "M.S.", "MPPS", "M.P.P.S.", "MSDS", "M.S.A.S."). Extrae solo el código/número limpio.
   - "doctorComezu": Número de matrícula del Colegio de Médicos (bajo "COMEZU:", "C.M.", "CMZ", "Colegio de Médicos"). ¡MUY IMPORTANTE!: Si el campo impreso "COMEZU:" está vacío en el formulario, busca minuciosamente dentro del SELLO HÚMEDO de la firma del médico (suele decir "COMEZU: 16216" o similar). Devuelve ÚNICAMENTE el número/código (ej: "16216"), NUNCA la palabra "COMEZU". Si no hay número en ningún lado, devuelve null.
   - "doctorSpecialty": Especialidad médica del doctor (busca en el campo "Especialidad:" de DATOS DEL MÉDICO, ej: "Medicina general", o en el sello del médico).

4. CONTENIDO CLÍNICO (revisa TODAS las páginas adjuntas):
   - "admissionDiagnosis": Diagnóstico de ingreso (bajo "DIAGNÓSTICO DE INGRESO", "Dx de ingreso", "IDX", "Impresión diagnóstica").
   - "medicalReport": Todo el cuerpo o desarrollo bajo la sección "INFORME MÉDICO". Si el texto del informe médico o las indicaciones médicas continúan en la página siguiente (antes de "DIAGNÓSTICO DE EGRESO"), concatena el texto de todas las páginas para que esté completo.
   - "dischargeDiagnosis": Diagnóstico de egreso (bajo "DIAGNÓSTICO DE EGRESO", que puede estar en la página 1 o en la página 2).

5. FECHA Y HORA DEL INFORME:
   - "reportDate": Fecha del informe en formato DD/MM/YYYY (busca "Fecha:" en el encabezado superior).
   - "reportTime": Hora indicada en el informe (busca "Hora:" en el encabezado superior, ej: "05:54:51 PM"). Si no aparece hora en el documento, devuelve null.

REGLAS GENERALES:
- Si algún dato no aparece en el documento o es completamente ilegible, devuelve null en ese campo.
- Devuelve ÚNICAMENTE un objeto JSON válido sin bloques markdown ni texto adicional:
{
  "reportType": (string|null),
  "company": (string|null),
  "doctorFullName": (string|null),
  "doctorIdentityCard": (string|null),
  "doctorMs": (string|null),
  "doctorComezu": (string|null),
  "doctorSpecialty": (string|null),
  "admissionDiagnosis": (string|null),
  "medicalReport": (string|null),
  "dischargeDiagnosis": (string|null),
  "reportDate": (string|null),
  "reportTime": (string|null)
}`;

      const response = await this.openai.chat.completions.create(
        {
          model: 'anthropic/claude-sonnet-5.5',
          messages: [
            {
              role: 'system',
              content:
                'Eres un asistente experto en lectura y extracción de datos de informes médicos clínicos venezolanos (impresos y manuscritos) y sellos médicos (MPPS/MS, COMEZU, C.I.). Extraes datos únicamente en formato JSON válido sin bloques de código markdown.',
            },
            {
              role: 'user',
              content: [{ type: 'text', text: prompt }, ...mediaBlocks],
            },
          ],
          temperature: 0,
        },
        { timeout: 45_000 },
      );

      const content = response.choices[0]?.message?.content?.trim() || '{}';
      const cleanJson = content
        .replace(/^```json\s*/i, '')
        .replace(/```$/i, '')
        .trim();

      const parsed = JSON.parse(cleanJson) as Partial<ExtractedMedicalReportResult>;

      const normalizeStr = (val: unknown): string | null => {
        if (typeof val !== 'string') return null;
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : null;
      };

      const rawComezu = normalizeStr(parsed.doctorComezu);
      const cleanedComezu =
        rawComezu && !/^comezu:?$/i.test(rawComezu)
          ? rawComezu.replace(/^comezu\s*:?\s*/i, '').trim() || null
          : null;

      return {
        reportType: normalizeStr(parsed.reportType),
        company: normalizeStr(parsed.company),
        doctorFullName: normalizeStr(parsed.doctorFullName),
        doctorIdentityCard: normalizeStr(parsed.doctorIdentityCard),
        doctorMs: normalizeStr(parsed.doctorMs),
        doctorComezu: cleanedComezu,
        doctorSpecialty: normalizeStr(parsed.doctorSpecialty),
        admissionDiagnosis: normalizeStr(parsed.admissionDiagnosis),
        medicalReport: normalizeStr(parsed.medicalReport),
        dischargeDiagnosis: normalizeStr(parsed.dischargeDiagnosis),
        reportDate: normalizeStr(parsed.reportDate),
        reportTime: normalizeStr(parsed.reportTime),
      };
    } catch (error) {
      this.logger.error('Error procesando informe médico con IA:', error);
      throw error;
    }
  }

  /**
   * Extrae los datos fiscales y totales desde un archivo PDF o imagen de factura fiscal de clínica/proveedor.
   */
  async extractProviderInvoiceData(
    imageUrlOrBuffer: string | Buffer,
    mimeType?: string,
  ): Promise<ExtractedProviderInvoiceResult> {
    const isTestEnv = this.configService.env === 'test';
    const apiKey = this.configService.openrouter.apiKey;

    if (!apiKey && !isTestEnv) {
      throw new Error('Missing OPENROUTER_API_KEY. Cannot process OCR.');
    }

    try {
      const mediaBlocks = this.buildMediaContentBlocks(
        imageUrlOrBuffer,
        mimeType,
        'provider-invoice.pdf',
      );

      const prompt = `Analiza detalladamente esta factura fiscal emitida por una clínica, centro médico o proveedor de salud venezolano.
Extrae los datos fiscales y montos principales:

1. DATOS DEL EMISOR / CLÍNICA:
   - "providerName": Razón Social o nombre comercial del proveedor/clínica (ej: "Policlínica San Antonio C.A.", "Centro Médico Quirúrgico").
   - "providerRif": RIF del emisor con su letra identificadora (ej: "J-30456789-0", "J-123456789").

2. IDENTIFICACIÓN DEL COMPROBANTE FISCAL:
   - "invoiceNumber": Número de la factura (busca "Factura N°", "Nro. Factura", "FACTURA", ej: "00045812", "45812").
   - "controlNumber": Número de control asignado por el SENIAT o imprenta autorizada (busca "N° de Control", "Control N°", "Nro. Control", ej: "00-0045812", "00-12345").
   - "invoiceDate": Fecha de emisión de la factura fiscal en formato YYYY-MM-DD. Si aparece como DD/MM/YYYY, conviértela estrictamente a YYYY-MM-DD.

3. MONTOS Y TOTALES:
   - "subtotalAmount": Subtotal antes de impuestos (suma de base imponible + montos exentos si aplica). Debe ser numérico positivo con punto decimal (ej: 150.00).
   - "taxAmount": Monto total del impuesto / IVA (ej: 24.00, o 0 si está exento).
   - "totalAmount": Monto total a pagar de la factura (Subtotal + IVA). Debe ser numérico con punto decimal (ej: 174.00).
   - "currency": "USD" si la factura está denominada en dólares estadounidenses ($ / USD), o "Bs" si está en bolívares (Bs. / VES). Si tiene ambas monedas, prioriza la moneda principal del total.

REGLAS GENERALES:
- Formato numérico: "1.250,50" -> 1250.50 (elimina puntos de miles y usa punto decimal).
- Si algún dato no aparece en el documento o no es identificable, devuelve null.
- Devuelve ÚNICAMENTE un objeto JSON válido sin bloques markdown ni texto adicional:
{
  "providerName": (string|null),
  "providerRif": (string|null),
  "invoiceNumber": (string|null),
  "controlNumber": (string|null),
  "invoiceDate": (string|null),
  "subtotalAmount": (number|null),
  "taxAmount": (number|null),
  "totalAmount": (number|null),
  "currency": ("USD"|"Bs"|null)
}`;

      const response = await this.openai.chat.completions.create(
        {
          model: 'anthropic/claude-sonnet-5.5',
          messages: [
            {
              role: 'system',
              content:
                'Eres un asistente experto en lectura de facturas fiscales venezolanas de clínicas y centros médicos. Extraes datos únicamente en formato JSON válido sin bloques markdown.',
            },
            {
              role: 'user',
              content: [{ type: 'text', text: prompt }, ...mediaBlocks],
            },
          ],
          temperature: 0,
        },
        { timeout: 45_000 },
      );

      const content = response.choices[0]?.message?.content?.trim() || '{}';
      const cleanJson = content
        .replace(/^```json\s*/i, '')
        .replace(/```$/i, '')
        .trim();

      const parsed = JSON.parse(cleanJson) as Partial<ExtractedProviderInvoiceResult>;

      const normalizeStr = (val: unknown): string | null => {
        if (typeof val !== 'string') return null;
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : null;
      };

      const normalizeNum = (val: unknown): number | null => {
        if (typeof val === 'number' && !Number.isNaN(val)) return val;
        if (typeof val === 'string') {
          const cleaned = val
            .replace(/\./g, '')
            .replace(',', '.')
            .replace(/[^0-9.-]/g, '');
          const n = parseFloat(cleaned);
          return Number.isNaN(n) ? null : n;
        }
        return null;
      };

      return {
        providerName: normalizeStr(parsed.providerName),
        providerRif: normalizeStr(parsed.providerRif),
        invoiceNumber: normalizeStr(parsed.invoiceNumber),
        controlNumber: normalizeStr(parsed.controlNumber),
        invoiceDate: normalizeStr(parsed.invoiceDate),
        subtotalAmount: normalizeNum(parsed.subtotalAmount),
        taxAmount: normalizeNum(parsed.taxAmount),
        totalAmount: normalizeNum(parsed.totalAmount),
        currency: parsed.currency === 'USD' || parsed.currency === 'Bs' ? parsed.currency : null,
      };
    } catch (error) {
      this.logger.error('Error procesando factura fiscal de proveedor con IA:', error);
      throw error;
    }
  }
}
