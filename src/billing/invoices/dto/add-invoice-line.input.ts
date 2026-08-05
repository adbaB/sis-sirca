import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';

/**
 * Interface interna tipada para agregar una línea a una factura.
 *
 * Usa `Exclude<>` para prevenir en tiempo de compilación que
 * se agregue una línea de tipo MENSUALIDAD como cargo adicional.
 */
export interface AddInvoiceLineInput {
  readonly category: Exclude<InvoiceLineCategory, InvoiceLineCategory.MENSUALIDAD>;
  readonly description: string;
  readonly amount: number;
  readonly quantity?: number;
  readonly personId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
