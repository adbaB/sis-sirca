import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaymentOrigin } from '../entities/payment.entity';

/**
 * Objeto de transferencia de datos (DTO) para la creación de un nuevo pago en el sistema.
 */
export class CreatePaymentDto {
  /** ID único (UUID) de una factura individual a pagar. */
  @IsUUID()
  @IsOptional()
  invoiceId?: string;

  /** Arreglo de IDs de facturas (UUIDs) para pagos agrupados o multi-factura. */
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  invoiceIds?: string[];

  /** Monto reportado en dólares (USD). Requerido para pagos en USD (e.g. Zelle). */
  @IsNumber()
  @IsOptional()
  amount?: number;

  /** Monto reportado extraído en Bolívares (Bs). Requerido para pagos en moneda local (e.g. Pago Móvil / Transferencia). */
  @IsNumber()
  @IsOptional()
  @Min(0)
  amountExtracted?: number;

  /** Método de pago utilizado (e.g. 'ZELLE', 'PAGO_MOVIL', 'TRANSFERENCIA'). */
  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  /** Número de referencia bancario o comprobante de la transacción. */
  @IsString()
  @IsNotEmpty()
  referenceNumber: string;

  /** Fecha de emisión del recibo/comprobante de pago (formato ISO o cadena válida de fecha). */
  @IsString()
  @IsOptional()
  datePaymentReceipt?: string;

  /** Fecha de la operación bancaria realizada. */
  @IsString()
  @IsOptional()
  operationDate?: string;

  /** Origen de donde proviene el pago (WEB o BOT). Por defecto es WEB. */
  @IsEnum(PaymentOrigin)
  @IsOptional()
  origin?: PaymentOrigin;

  /** URL del archivo de comprobante almacenado (p. ej. en AWS S3). */
  @IsString()
  @IsOptional()
  url?: string;

  /** ID único (UUID) de la persona que realiza o reporta el pago. */
  @IsUUID()
  @IsOptional()
  personId?: string;

  /** Metadatos adicionales en formato clave-valor asociados al pago. */
  @IsOptional()
  metadata?: Record<string, unknown>;
}
