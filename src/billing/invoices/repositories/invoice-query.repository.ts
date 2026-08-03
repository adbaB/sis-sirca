import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { InvoiceLine } from '../entities/invoice-line.entity';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';
import { Payment, PaymentStatus } from '../../payments/entities/payment.entity';

/**
 * Centraliza los QueryBuilders repetitivos para el cálculo de montos
 * de una factura. Todos los métodos reciben un `EntityManager` explícito
 * para poder operar dentro de cualquier transacción activa.
 */
@Injectable()
export class InvoiceQueryRepository {
  /**
   * Suma `amount * quantity` de las líneas MENSUALIDAD activas (proyectables).
   * Representa el `baseAmount` de la factura.
   */
  async sumBaseLines(manager: EntityManager, invoiceId: string): Promise<number> {
    const result = await manager
      .createQueryBuilder(InvoiceLine, 'il')
      .select('COALESCE(SUM(il.amount * il.quantity), 0)', 'total')
      .where('il.invoice_id = :invoiceId', { invoiceId })
      .andWhere('il.category = :cat', { cat: InvoiceLineCategory.MENSUALIDAD })
      .andWhere('il.deleted_at IS NULL')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  /**
   * Suma `amount * quantity` de las líneas NO proyectables activas.
   * Representa los cargos adicionales (COMISION, INCLUSION, RECOBRO, IMPUESTO).
   */
  async sumAdditionalLines(manager: EntityManager, invoiceId: string): Promise<number> {
    const result = await manager
      .createQueryBuilder(InvoiceLine, 'il')
      .select('COALESCE(SUM(il.amount * il.quantity), 0)', 'total')
      .where('il.invoice_id = :invoiceId', { invoiceId })
      .andWhere('il.is_projectable = false')
      .andWhere('il.deleted_at IS NULL')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  /**
   * Suma los pagos en estado PROCESSING o COMPLETED para una factura.
   * Representa el `paidAmount` real calculado desde los registros de pago.
   */
  async sumCompletedPayments(manager: EntityManager, invoiceId: string): Promise<number> {
    const result = await manager
      .createQueryBuilder(Payment, 'payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'total')
      .where('payment.invoice_id = :invoiceId', { invoiceId })
      .andWhere('payment.status IN (:...statuses)', {
        statuses: [PaymentStatus.PROCESSING, PaymentStatus.COMPLETED],
      })
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }
}
