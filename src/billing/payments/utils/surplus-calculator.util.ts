import { BadRequestException } from '@nestjs/common';

/**
 * Resultado de la aplicación del saldo a favor / excedente contra la deuda de una factura.
 */
export interface SurplusApplicationResult {
  /** Monto total disponible en el excedente expresado en USD. */
  paymentAmountUsd: number;
  /** Monto total disponible en el excedente expresado en Bs. */
  paymentAmountBs: number;
  /** Monto efectivo del excedente que se aplicó a la factura en USD. */
  amountToApplyUsd: number;
  /** Monto efectivo del excedente que se aplicó a la factura en Bs. */
  amountToApplyBs: number;
  /** Monto remanente sobrante del excedente en USD tras imputar el pago, o null si se consumió totalmente. */
  leftoverUsd: number | null;
  /** Monto remanente sobrante del excedente en Bs tras imputar el pago, o null si se consumió totalmente. */
  leftoverBs: number | null;
  /** Indica si quedó saldo a favor remanente sin consumir. */
  hasLeftover: boolean;
}

/**
 * Calcula de manera pura cómo imputar un registro de excedente/saldo a favor contra el saldo pendiente de una factura.
 * Maneja la conversión de monedas si el excedente fue guardado originalmente en Bolívares.
 *
 * @param surplusAmountUsd - Monto del excedente en USD (o null si es en Bs).
 * @param surplusAmountBs - Monto del excedente en Bs (o null si es en USD).
 * @param remainingBalanceUsd - Saldo deudor pendiente actual de la factura en USD.
 * @param rateUsd - Tasa de cambio vigente (Bs / USD), requerida si el excedente está en Bs.
 * @returns Objeto {@link SurplusApplicationResult} con los desgloses aplicados y los sobrantes remanentes.
 * @throws BadRequestException Si el excedente está en Bs y no se provee una tasa de cambio válida.
 */
export function calculateSurplusApplication(
  surplusAmountUsd: number | null,
  surplusAmountBs: number | null,
  remainingBalanceUsd: number,
  rateUsd?: number,
): SurplusApplicationResult {
  let paymentAmountUsd = 0;
  let paymentAmountBs = 0;

  const rawBs = surplusAmountBs ? Number(surplusAmountBs) : 0;
  const rawUsd = surplusAmountUsd ? Number(surplusAmountUsd) : 0;

  if (rawBs > 0) {
    if (!rateUsd || !Number.isFinite(rateUsd) || rateUsd <= 0) {
      throw new BadRequestException('Exchange rate required for Bs surplus calculation');
    }
    paymentAmountBs = rawBs;
    paymentAmountUsd = paymentAmountBs / rateUsd;
  } else if (rawUsd > 0) {
    paymentAmountUsd = rawUsd;
  }

  if (paymentAmountUsd <= 0) {
    return {
      paymentAmountUsd: 0,
      paymentAmountBs: 0,
      amountToApplyUsd: 0,
      amountToApplyBs: 0,
      leftoverUsd: null,
      leftoverBs: null,
      hasLeftover: false,
    };
  }

  let amountToApplyUsd = paymentAmountUsd;
  let amountToApplyBs = paymentAmountBs;
  let leftoverUsd: number | null = null;
  let leftoverBs: number | null = null;
  let hasLeftover = false;

  if (paymentAmountUsd > remainingBalanceUsd) {
    amountToApplyUsd = remainingBalanceUsd;

    const proportion = amountToApplyUsd / paymentAmountUsd;
    amountToApplyBs = paymentAmountBs * proportion;

    leftoverUsd = surplusAmountUsd !== null ? paymentAmountUsd - amountToApplyUsd : null;
    leftoverBs = surplusAmountBs !== null ? paymentAmountBs - amountToApplyBs : null;
    hasLeftover = true;
  }

  return {
    paymentAmountUsd,
    paymentAmountBs,
    amountToApplyUsd,
    amountToApplyBs,
    leftoverUsd,
    leftoverBs,
    hasLeftover,
  };
}
