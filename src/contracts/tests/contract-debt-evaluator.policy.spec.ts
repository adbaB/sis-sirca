import { evaluateOverdueInvoices } from '../policies/contract-debt-evaluator.policy';
import { Invoice, InvoiceStatus } from '../../billing/invoices/entities/invoice.entity';
import { Payment, PaymentStatus } from '../../billing/payments/entities/payment.entity';

describe('evaluateOverdueInvoices (Domain Policy)', () => {
  const now = new Date('2026-09-08T12:00:00Z');

  it('should return no debt if invoices array is empty', () => {
    const result = evaluateOverdueInvoices([], now);

    expect(result.hasOverdueDebt).toBe(false);
    expect(result.totalOverdueRemaining).toBe(0);
    expect(result.totalProcessingOnOverdue).toBe(0);
    expect(result.isCoveredByProcessingOrPaid).toBe(true);
    expect(result.overdueInvoices).toEqual([]);
    expect(result.overdueInvoicesWithDebt).toEqual([]);
  });

  it('should ignore invoices with future dueDate', () => {
    const futureInvoice = {
      id: 'inv-1',
      status: InvoiceStatus.PENDING,
      dueDate: '2026-09-15',
      totalAmount: 100,
    } as unknown as Invoice;

    const result = evaluateOverdueInvoices([futureInvoice], now);

    expect(result.hasOverdueDebt).toBe(false);
    expect(result.overdueInvoices).toEqual([]);
  });

  it('should ignore overdue invoices that are already PAID or CANCELLED', () => {
    const paidInvoice = {
      id: 'inv-1',
      status: InvoiceStatus.PAID,
      dueDate: '2026-09-01',
      totalAmount: 100,
    } as unknown as Invoice;

    const result = evaluateOverdueInvoices([paidInvoice], now);

    expect(result.hasOverdueDebt).toBe(false);
    expect(result.overdueInvoices).toEqual([]);
  });

  it('should calculate debt accurately deducting retention and paid amount', () => {
    const invoice = {
      id: 'inv-1',
      status: InvoiceStatus.PARTIAL,
      dueDate: '2026-09-01',
      totalAmount: 100,
      retentionAmount: 10,
      paidAmount: 30,
      payments: [],
    } as unknown as Invoice;

    const result = evaluateOverdueInvoices([invoice], now);

    expect(result.hasOverdueDebt).toBe(true);
    expect(result.totalOverdueRemaining).toBe(60); // 100 - 10 - 30
    expect(result.totalProcessingOnOverdue).toBe(0);
    expect(result.isCoveredByProcessingOrPaid).toBe(false);
    expect(result.overdueInvoicesWithDebt).toHaveLength(1);
  });

  it('should consider debt covered if PROCESSING payments cover or exceed remaining debt', () => {
    const invoice = {
      id: 'inv-1',
      status: InvoiceStatus.PENDING,
      dueDate: '2026-09-01',
      totalAmount: 50,
      retentionAmount: 0,
      paidAmount: 0,
      payments: [
        {
          id: 'pay-1',
          status: PaymentStatus.PROCESSING,
          amount: 50,
          deletedAt: null,
        } as unknown as Payment,
      ],
    } as unknown as Invoice;

    const result = evaluateOverdueInvoices([invoice], now);

    expect(result.hasOverdueDebt).toBe(true);
    expect(result.totalOverdueRemaining).toBe(50);
    expect(result.totalProcessingOnOverdue).toBe(50);
    expect(result.isCoveredByProcessingOrPaid).toBe(true);
  });

  it('should ignore deleted PROCESSING payments', () => {
    const invoice = {
      id: 'inv-1',
      status: InvoiceStatus.PENDING,
      dueDate: '2026-09-01',
      totalAmount: 50,
      retentionAmount: 0,
      paidAmount: 0,
      payments: [
        {
          id: 'pay-1',
          status: PaymentStatus.PROCESSING,
          amount: 50,
          deletedAt: new Date(),
        } as unknown as Payment,
      ],
    } as unknown as Invoice;

    const result = evaluateOverdueInvoices([invoice], now);

    expect(result.hasOverdueDebt).toBe(true);
    expect(result.totalProcessingOnOverdue).toBe(0);
    expect(result.isCoveredByProcessingOrPaid).toBe(false);
  });
});
