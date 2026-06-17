import { DateTime } from 'luxon';

/**
 * Retorna el billingMonth (YYYY-MM) correcto según el ciclo de facturación.
 *
 * El cron genera facturas el día 25 para el MES SIGUIENTE, por lo tanto:
 * - Antes del 25: la factura activa es del mes actual
 * - A partir del 25: la factura activa es del mes siguiente
 *
 * Usa timezone Venezuela (America/Caracas).
 */
export function getBillingMonth(): string {
  const now = DateTime.now().setZone('America/Caracas');

  if (now.day >= 25) {
    const next = now.plus({ months: 1 });
    return next.toFormat('yyyy-MM');
  }

  return now.toFormat('yyyy-MM');
}
