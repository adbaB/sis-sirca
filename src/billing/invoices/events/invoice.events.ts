/**
 * Nombre del evento emitido cuando una factura es creada exitosamente.
 * El SurplusService escucha este evento para aplicar excedentes pendientes
 * en su propia transacción separada.
 */
export const INVOICE_CREATED = 'invoice.created';

/**
 * Payload del evento `invoice.created`.
 * Contiene los datos mínimos que necesita el listener para actuar.
 */
export class InvoiceCreatedEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly contractId: string,
  ) {}
}
