import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Surplus, SurplusStatus } from '../entities/surplus.entity';
import { InvoiceService } from '../../invoices/services/invoice.service';
import { Transactional } from '../../../common/decorators/transactional.decorator';
import { getQueryRunner, getQueryRunnerSafe } from '../../../common/context/request-context';
import { getCaracasTodayJSDate } from '../../../common/utils/date.util';
import { Repository } from 'typeorm/repository/Repository';
import { InjectRepository } from '@nestjs/typeorm';

/**
 * Servicio encargado de gestionar los cambios de estado transaccionales de los pagos.
 * Maneja la transición de estados (PROCESSING -> COMPLETED / REJECTED), actualización de metadatos,
 * sincronización de excedentes asociados y recalculación del estado de facturas.
 */
@Injectable()
export class PaymentStateService {
  private readonly logger = new Logger(PaymentStateService.name);
  constructor(
    private readonly invoiceService: InvoiceService,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  /**
   * Aprueba un pago en estado `PROCESSING`, cambiando su estado a `COMPLETED`.
   * Restaura los excedentes asociados que estaban cancelados a estado `PENDING`
   * y recalcula el monto pagado en la factura correspondiente.
   *
   * @param id - Identificador UUID del pago a aprobar.
   * @returns Promesa con el registro {@link Payment} actualizado y rellenado con sus relaciones.
   * @throws NotFoundException Si el pago no existe.
   * @throws BadRequestException Si el pago ya se encuentra en estado COMPLETED.
   */
  @Transactional()
  async approvePayment(id: string): Promise<Payment> {
    const qr = getQueryRunner();
    const paymentRepo = qr.manager.getRepository(Payment);
    const surplusRepo = qr.manager.getRepository(Surplus);

    const payment = await qr.manager
      .createQueryBuilder(Payment, 'payment')
      .setQueryRunner(qr)
      .innerJoinAndSelect('payment.invoice', 'invoice')
      .where('payment.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    if (payment.status === PaymentStatus.COMPLETED) {
      throw new BadRequestException('El pago ya se encuentra aprobado.');
    }

    payment.status = PaymentStatus.COMPLETED;

    // Remove rejection reason from metadata if present
    const metadata = payment.metadata || {};
    if (metadata.rejectionReason) {
      delete metadata.rejectionReason;
    }
    payment.metadata = metadata;

    await paymentRepo.save(payment);

    // Find and restore associated surpluses (from cancelled to pending)
    const associatedSurpluses = await surplusRepo.find({
      where: { payment: { id: payment.id } },
    });

    for (const surplus of associatedSurpluses) {
      if (surplus.status === SurplusStatus.CANCELLED) {
        surplus.status = SurplusStatus.PENDING;
        await surplusRepo.save(surplus);
      }
    }

    if (payment.invoice) {
      await this.invoiceService.recalculateInvoicePaidAmount(payment.invoice.id, qr);
    }

    const reloadedPayment = await paymentRepo.findOne({
      where: { id },
      relations: ['person', 'invoice', 'invoice.contract', 'surpluses'],
    });

    if (!reloadedPayment) {
      throw new NotFoundException(`Pago con ID ${id} no encontrado tras guardar`);
    }

    return reloadedPayment;
  }

  /**
   * Rechaza un pago en estado `PROCESSING`, cambiando su estado a `REJECTED`.
   * Registra el motivo en `metadata.rejectionReason`, cancela los excedentes asociados
   * que estén en estado `PENDING` y recalcula la factura.
   *
   * @param id - Identificador UUID del pago a rechazar.
   * @param reason - Justificación del rechazo por parte de la administración.
   * @returns Promesa con el registro {@link Payment} actualizado.
   * @throws NotFoundException Si el pago no existe.
   * @throws BadRequestException Si el pago ya se encuentra en estado REJECTED.
   */
  @Transactional()
  async rejectPayment(id: string, reason: string): Promise<Payment> {
    const qr = getQueryRunner();
    const paymentRepo = qr.manager.getRepository(Payment);
    const surplusRepo = qr.manager.getRepository(Surplus);

    const payment = await qr.manager
      .createQueryBuilder(Payment, 'payment')
      .setQueryRunner(qr)
      .innerJoinAndSelect('payment.invoice', 'invoice')
      .where('payment.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    if (payment.status === PaymentStatus.REJECTED) {
      throw new BadRequestException('El pago ya se encuentra rechazado.');
    }

    payment.status = PaymentStatus.REJECTED;
    const metadata = payment.metadata || {};
    metadata.rejectionReason = reason;
    payment.metadata = metadata;

    await paymentRepo.save(payment);

    // Find and cancel associated surpluses
    const associatedSurpluses = await surplusRepo.find({
      where: { payment: { id: payment.id } },
    });

    for (const surplus of associatedSurpluses) {
      if (surplus.status === SurplusStatus.PENDING) {
        surplus.status = SurplusStatus.CANCELLED;
        await surplusRepo.save(surplus);
      }
    }

    if (payment.invoice) {
      await this.invoiceService.recalculateInvoicePaidAmount(payment.invoice.id, qr);
    }

    const reloadedPayment = await paymentRepo.findOne({
      where: { id },
      relations: ['person', 'invoice', 'invoice.contract', 'surpluses'],
    });

    if (!reloadedPayment) {
      throw new NotFoundException(`Pago con ID ${id} no encontrado tras guardar`);
    }

    return reloadedPayment;
  }

  /**
   * Marca un grupo de pagos como notificados o enviados fijando la marca de tiempo `sendAt` a la hora actual de Caracas.
   *
   * @param payments - Arreglo de pagos a actualizar.
   * @returns `true` si la operación se ejecutó con éxito, `false` en caso de error.
   */
  @Transactional()
  async markPaymentsAsSent(payments: Payment[]): Promise<boolean> {
    const qr = getQueryRunnerSafe();
    const repo = qr ? qr.manager.getRepository(Payment) : this.paymentRepository;
    const now = getCaracasTodayJSDate();
    for (const payment of payments) {
      payment.sendAt = now;
    }
    await repo.save(payments);
    return true;
  }
}
