import { BadRequestException, Injectable } from '@nestjs/common';
import { AwsService } from '../../../aws/aws.service';
import { OcrService } from '../../../ocr/ocr.service';
import { parseOcrDateToISO } from '../../../common/utils/date.util';

export interface ReceiptAnalysisResult {
  referenceNumber: string;
  amount: number | null;
  amountBs: number | null;
  paymentDate: string | null;
  operationDate: string | null;
  paymentMethod: string;
  bank: string;
  url: string;
}

/**
 * Servicio encargado de procesar y analizar comprobantes de pago subidos por usuarios o asesores.
 * Integra `AwsService` para el almacenamiento de archivos en S3 y `OcrService` para el reconocimiento
 * automático de texto (OCR) y extracción de metadatos bancarios.
 */
@Injectable()
export class ReceiptAnalysisService {
  constructor(
    private readonly awsService: AwsService,
    private readonly ocrService: OcrService,
  ) {}

  /**
   * Recibe un archivo binario de comprobante, lo carga en S3, ejecuta la extracción por OCR,
   * normaliza la fecha, moneda, montos y método de pago (ZELLE, PAGO_MOVIL, TRANSFERENCIA).
   *
   * @param file - Archivo de imagen o PDF subido mediante Multer.
   * @returns Objeto estructurado con número de referencia, montos, fechas, banco y URL en S3.
   * @throws BadRequestException Si no se adjunta ningún archivo.
   */
  async analyzeReceipt(file: Express.Multer.File): Promise<ReceiptAnalysisResult> {
    if (!file) {
      throw new BadRequestException('Se requiere un archivo de comprobante.');
    }

    const s3Url = await this.awsService.uploadFile(file);
    const ocrResult = await this.ocrService.extractReceiptData(s3Url);
    const formattedDate = parseOcrDateToISO(ocrResult.fecha);

    const currency = ocrResult.moneda ? ocrResult.moneda.trim().toUpperCase() : '';
    let mappedMethod = 'PAGO_MOVIL';
    let amountUsd: number | null = null;
    let amountBsVal: number | null = null;
    const ocrAmount = ocrResult.monto || 0;

    if (currency === 'USD') {
      mappedMethod = 'ZELLE';
      amountUsd = ocrAmount > 0 ? ocrAmount : null;
    } else if (currency === 'BS' || currency === 'VES') {
      amountBsVal = ocrAmount > 0 ? ocrAmount : null;
      if (ocrResult.origen) {
        const originUpper = ocrResult.origen.toUpperCase();
        if (originUpper.includes('ZELLE')) {
          mappedMethod = 'ZELLE';
        } else if (originUpper.includes('TRANS') || originUpper.includes('DEP')) {
          mappedMethod = 'TRANSFERENCIA';
        }
      }
    } else if (ocrResult.origen) {
      const originUpper = ocrResult.origen.toUpperCase();
      if (originUpper.includes('ZELLE')) {
        mappedMethod = 'ZELLE';
        amountUsd = ocrAmount > 0 ? ocrAmount : null;
      } else if (originUpper.includes('TRANS') || originUpper.includes('DEP')) {
        mappedMethod = 'TRANSFERENCIA';
        amountBsVal = ocrAmount > 0 ? ocrAmount : null;
      }
    }

    return {
      referenceNumber: ocrResult.referencia || '',
      amount: amountUsd,
      amountBs: amountBsVal,
      paymentDate: formattedDate,
      operationDate: formattedDate,
      paymentMethod: mappedMethod,
      bank: ocrResult.nombreBanco || ocrResult.origen || '',
      url: s3Url,
    };
  }
}
