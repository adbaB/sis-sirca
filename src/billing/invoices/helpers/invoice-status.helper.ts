import { InvoiceStatus } from '../entities/invoice.entity';

/**
 * Determina el InvoiceStatus a partir de los montos de la factura.
 *
 * Es una función pura sin efectos secundarios: no depende de ningún
 * repositorio ni servicio externo, lo que la hace trivialmente testeable.
 *
 * @param paidAmount   - Monto ya pagado de la factura
 * @param totalAmount  - Monto total de la factura
 * @param retentionAmount - Monto de retención aplicado
 * @returns InvoiceStatus correspondiente al estado actual
 */
export function resolveInvoiceStatus(
  paidAmount: number,
  totalAmount: number,
  retentionAmount: number,
): InvoiceStatus {
  const amountDue = Math.max(0, totalAmount - retentionAmount);

  if (totalAmount > 0 && paidAmount >= amountDue) {
    return InvoiceStatus.PAID;
  }

  if (paidAmount > 0) {
    return paidAmount >= amountDue ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;
  }

  return InvoiceStatus.PENDING;
}
