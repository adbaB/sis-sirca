import { Payment } from '../entities/payment.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';

/**
 * Representa la división de montos aplicados a una factura vs. saldo a favor (excedente).
 */
export interface PaymentSplit {
  /** Monto en USD que cubre parte o el total de la deuda de la factura. */
  paymentAmountUsd: number;
  /** Monto en Bolívares (Bs) equivalente aplicado a la factura. */
  paymentAmountBs: number;
  /** Monto sobrante en USD generado como excedente/saldo a favor, o null si no aplica. */
  surplusAmountUsd: number | null;
  /** Monto sobrante en Bs generado como excedente/saldo a favor, o null si no aplica. */
  surplusAmountBs: number | null;
}

/**
 * Resultado estructurado retornado tras procesar la transacción de creación de pago.
 */
export interface TransactionResult {
  /** El primer (o principal) registro de pago guardado. */
  savedPayment: Payment;
  /** Lista de todos los registros de pago guardados (en caso de pagos multi-factura). */
  savedPayments: Payment[];
  /** La primera factura procesada dentro de la transacción. */
  invoice: Invoice;
  /** ID del registro de excedente generado, si aplica. */
  surplusId: string | null;
  /** Monto del excedente generado en USD. */
  surplusAmountUsd: number | null;
  /** Monto del excedente generado en Bs. */
  surplusAmountBs: number | null;
  /** Fecha efectiva del pago procesado. */
  paymentDate: Date;
  /** Saldo pendiente por pagar restante en USD en las facturas involucradas. */
  remainingUnpaidUsd: number;
  /** Saldo pendiente por pagar restante en Bs en las facturas involucradas. */
  remainingUnpaidBs: number;
}
