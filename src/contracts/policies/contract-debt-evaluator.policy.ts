import { Invoice, InvoiceStatus } from '../../billing/invoices/entities/invoice.entity';
import { PaymentStatus } from '../../billing/payments/entities/payment.entity';

export interface ContractOverdueDebtResult {
  hasOverdueDebt: boolean;
  totalOverdueRemaining: number;
  totalProcessingOnOverdue: number;
  isCoveredByProcessingOrPaid: boolean;
  overdueInvoicesWithDebt: Invoice[];
  overdueInvoices: Invoice[];
}

export function evaluateOverdueInvoices(
  invoices: Invoice[],
  nowDate: Date,
): ContractOverdueDebtResult {
  const overdueInvoices = invoices.filter(
    (inv) =>
      (inv.status === InvoiceStatus.PENDING || inv.status === InvoiceStatus.PARTIAL) &&
      inv.dueDate &&
      new Date(inv.dueDate) <= nowDate,
  );

  let totalOverdueRemaining = 0;
  let totalProcessingOnOverdue = 0;
  const overdueInvoicesWithDebt: Invoice[] = [];

  for (const inv of overdueInvoices) {
    const totalAmount = Number(inv.totalAmount);
    const retentionAmount = Number(inv.retentionAmount || 0);
    const paidAmount = Number(inv.paidAmount || 0);
    const amountDue = Math.max(0, totalAmount - retentionAmount - paidAmount);

    if (amountDue > 0) {
      totalOverdueRemaining += amountDue;
      overdueInvoicesWithDebt.push(inv);

      const processingPayments = (inv.payments || []).filter(
        (p) => p.status === PaymentStatus.PROCESSING && !p.deletedAt,
      );
      for (const p of processingPayments) {
        totalProcessingOnOverdue += Number(p.amount);
      }
    }
  }

  const hasOverdueDebt = totalOverdueRemaining > 0;
  const isCoveredByProcessingOrPaid =
    !hasOverdueDebt || totalProcessingOnOverdue >= totalOverdueRemaining;

  return {
    hasOverdueDebt,
    totalOverdueRemaining,
    totalProcessingOnOverdue,
    isCoveredByProcessingOrPaid,
    overdueInvoicesWithDebt,
    overdueInvoices,
  };
}
