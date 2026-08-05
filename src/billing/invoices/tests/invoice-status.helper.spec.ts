import { InvoiceStatus } from '../entities/invoice.entity';
import { resolveInvoiceStatus } from '../helpers/invoice-status.helper';

describe('resolveInvoiceStatus', () => {
  it('devuelve PENDING cuando paidAmount es 0', () => {
    expect(resolveInvoiceStatus(0, 100, 0)).toBe(InvoiceStatus.PENDING);
  });

  it('devuelve PARTIAL cuando paidAmount > 0 pero menor que amountDue', () => {
    expect(resolveInvoiceStatus(50, 100, 0)).toBe(InvoiceStatus.PARTIAL);
  });

  it('devuelve PAID cuando paidAmount >= amountDue', () => {
    expect(resolveInvoiceStatus(100, 100, 0)).toBe(InvoiceStatus.PAID);
  });

  it('devuelve PAID cuando paidAmount >= (totalAmount - retentionAmount)', () => {
    // totalAmount=100, retentionAmount=10 → amountDue=90
    expect(resolveInvoiceStatus(90, 100, 10)).toBe(InvoiceStatus.PAID);
  });

  it('devuelve PARTIAL cuando paidAmount cubre retención pero no todo', () => {
    // totalAmount=100, retentionAmount=10 → amountDue=90
    expect(resolveInvoiceStatus(50, 100, 10)).toBe(InvoiceStatus.PARTIAL);
  });

  it('devuelve PENDING cuando paidAmount es 0 y hay retención', () => {
    expect(resolveInvoiceStatus(0, 100, 10)).toBe(InvoiceStatus.PENDING);
  });

  it('no devuelve PAID cuando amountDue es 0 (evita factura de $0 marcada como pagada)', () => {
    // totalAmount=0, retentionAmount=0 → amountDue=0
    // amountDue debe ser > 0 para marcar como PAID
    expect(resolveInvoiceStatus(0, 0, 0)).toBe(InvoiceStatus.PENDING);
  });

  it('devuelve PAID cuando paidAmount supera amountDue (overpayment)', () => {
    expect(resolveInvoiceStatus(150, 100, 0)).toBe(InvoiceStatus.PAID);
  });
});
