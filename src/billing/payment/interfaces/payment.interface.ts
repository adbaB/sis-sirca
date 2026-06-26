import { Payment } from '../../entities/payment.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';

export interface PaymentSplit {
  paymentAmountUsd: number;
  paymentAmountBs: number;
  surplusAmountUsd: number | null;
  surplusAmountBs: number | null;
}

export interface TransactionResult {
  savedPayment: Payment;
  invoice: Invoice;
  surplusId: string | null;
  surplusAmountUsd: number | null;
  surplusAmountBs: number | null;
  paymentDate: Date;
  remainingUnpaidUsd: number;
  remainingUnpaidBs: number;
}
