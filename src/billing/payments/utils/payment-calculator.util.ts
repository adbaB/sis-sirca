import { BadRequestException } from '@nestjs/common';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PaymentSplit } from '../interfaces/payment.interface';

/**
 * Redondea un valor numérico monetario a exactamente 2 decimales para prevenir
 * errores de imprecisión en aritmética de punto flotante (IEEE 754).
 *
 * @param val - Número a redondear.
 * @returns Número redondeado a 2 decimales.
 */
export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Valida que los montos recibidos en el DTO de pago sean números finitos y positivos.
 * Para pagos en Zelle se valida el monto en USD; para métodos locales se valida el monto en Bs.
 *
 * @param dto - DTO con la información recibida del pago.
 * @param amount - Monto en USD extraído o enviado.
 * @param amountExtracted - Monto en Bolívares extraído o enviado.
 * @throws BadRequestException Si el monto respectivo no es válido o es <= 0.
 */
export function validateAmounts(
  dto: CreatePaymentDto,
  amount: number,
  amountExtracted: number,
): void {
  const isZelle = dto.paymentMethod?.toLowerCase() === 'zelle';
  if (isZelle) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }
  } else {
    if (!Number.isFinite(amountExtracted) || amountExtracted <= 0) {
      throw new BadRequestException('Payment amount Bs must be greater than 0');
    }
  }
}

/**
 * Resuelve el monto total del pago en dólares (USD).
 * Para métodos distintos a Zelle, si se proporciona el monto en Bs (`amountExtracted`),
 * se convierte a USD dividiendo entre la tasa de cambio vigente (`rateUsd`).
 *
 * @param dto - DTO de creación de pago.
 * @param amount - Monto en USD directo.
 * @param rateUsd - Tasa de cambio vigente (Bs / USD).
 * @returns Monto total equivalente en USD redondeado a 2 decimales.
 */
export function resolveAmountUsd(dto: CreatePaymentDto, amount: number, rateUsd: number): number {
  const isZelle = dto.paymentMethod?.toLowerCase() === 'zelle';
  if (!isZelle && dto.amountExtracted) {
    return round2(dto.amountExtracted / rateUsd);
  }
  return round2(amount);
}

/**
 * Determina qué proporción del pago cubre el saldo pendiente de la factura y
 * cuánto se convierte en excedente (saldo a favor).
 *
 * @param amountUsd - Monto total ingresado en USD.
 * @param invoiceUnpaidAmount - Saldo pendiente actual de la factura en USD.
 * @param amountExtracted - Monto total ingresado en Bolívares.
 * @param paymentMethod - Método de pago utilizado (e.g. 'ZELLE', 'PAGO_MOVIL').
 * @param rateUsd - Tasa de cambio de la fecha de pago (Bs / USD).
 * @returns Objeto {@link PaymentSplit} con la distribución de montos de pago y excedente.
 */
export function computePaymentSplit(
  amountUsd: number,
  invoiceUnpaidAmount: number,
  amountExtracted: number,
  paymentMethod: string,
  rateUsd: number,
): PaymentSplit {
  let paymentAmountUsd = round2(amountUsd);
  const isZelle = paymentMethod.toLowerCase() === 'zelle';
  let paymentAmountBs = !isZelle ? round2(amountExtracted) : 0;
  let surplusAmountUsd: number | null = null;
  let surplusAmountBs: number | null = null;

  if (amountUsd > invoiceUnpaidAmount) {
    const surplusUsd = round2(amountUsd - invoiceUnpaidAmount);

    if (isZelle) {
      surplusAmountUsd = surplusUsd;
    } else {
      surplusAmountBs = round2(surplusUsd * rateUsd);
    }

    // Limitar el pago abonado a la factura exactamente a lo que debe
    paymentAmountUsd = round2(invoiceUnpaidAmount);
    paymentAmountBs = !isZelle ? round2(amountExtracted - (surplusAmountBs ?? 0)) : 0;
  }

  return { paymentAmountUsd, paymentAmountBs, surplusAmountUsd, surplusAmountBs };
}
