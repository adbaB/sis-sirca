import { Injectable } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { Payment } from '../entities/payment.entity';
import { TransactionResult } from '../interfaces/payment.interface';
import { PaymentCreationService } from './payment-creation.service';
import { PaymentStateService } from './payment-state.service';
import { PaymentUpdateService } from './payment-update.service';
import { PaymentQueryService } from './payment-query.service';

/**
 * `PaymentService` actúa como una Fachada (Facade) unificada que delega todas las responsabilidades
 * de dominio de pagos a sus sub-servicios especializados (`PaymentCreationService`, `PaymentStateService`,
 * `PaymentUpdateService`, `PaymentQueryService`).
 *
 * Mantiene la compatibilidad hacia atrás con los controladores y servicios existentes que consumen `PaymentService`.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly paymentCreationService: PaymentCreationService,
    private readonly paymentStateService: PaymentStateService,
    private readonly paymentUpdateService: PaymentUpdateService,
    private readonly paymentQueryService: PaymentQueryService,
  ) {}

  /**
   * Registra y procesa un nuevo pago en el sistema dentro de un flujo transaccional.
   *
   * @param createPaymentDto - Datos del pago a registrar.
   * @param externalQueryRunner - QueryRunner opcional si forma parte de una transacción externa.
   * @returns Promesa con el resultado de la transacción (pago guardado, excedentes, etc.).
   */
  createPayment(
    createPaymentDto: CreatePaymentDto,
    externalQueryRunner?: QueryRunner,
  ): Promise<TransactionResult> {
    return this.paymentCreationService.createPayment(createPaymentDto, externalQueryRunner);
  }

  /**
   * Consulta y retorna una lista paginada de pagos aplicando filtros por estado, búsqueda o período.
   *
   * @param page - Número de página actual.
   * @param limit - Tamaño de página.
   * @param status - Estado del pago a filtrar.
   * @param search - Término de búsqueda (referencia, cédula, código de contrato).
   * @param month - Mes de facturación (1-12).
   * @param year - Año de facturación.
   * @returns Objeto paginado con los pagos encontrados.
   */
  findPayments(
    page = 1,
    limit = 10,
    status?: string,
    search?: string,
    month?: number,
    year?: number,
  ) {
    return this.paymentQueryService.findPayments(page, limit, status, search, month, year);
  }

  /**
   * Obtiene el conteo total de pagos actualmente en estado pendiente (`PROCESSING`).
   *
   * @returns Promesa con el número entero de pagos pendientes.
   */
  countPendingPayments(): Promise<number> {
    return this.paymentQueryService.countPendingPayments();
  }

  /**
   * Aprueba administrativamente un pago registrado, cambiando su estado a `COMPLETED`.
   *
   * @param id - Identificador UUID del pago.
   * @returns Promesa con la entidad {@link Payment} actualizada.
   */
  approvePayment(id: string): Promise<Payment> {
    return this.paymentStateService.approvePayment(id);
  }

  /**
   * Rechaza un pago registrado indicando una justificación, cambiando su estado a `REJECTED`.
   *
   * @param id - Identificador UUID del pago.
   * @param reason - Motivo o justificación del rechazo.
   * @returns Promesa con la entidad {@link Payment} actualizada.
   */
  rejectPayment(id: string, reason: string): Promise<Payment> {
    return this.paymentStateService.rejectPayment(id, reason);
  }

  /**
   * Actualiza la fecha de un pago existente y recalcula los valores de conversión y excedentes.
   *
   * @param id - Identificador UUID del pago.
   * @param newDateStr - Cadena con la nueva fecha asignada al pago.
   * @returns Promesa con la entidad {@link Payment} actualizada.
   */
  updatePaymentDate(id: string, newDateStr: string): Promise<Payment> {
    return this.paymentUpdateService.updatePaymentDate(id, newDateStr);
  }

  /**
   * Obtiene todos los pagos completados cuya notificación/envío no ha sido marcado aún (`sendAt` nulo).
   *
   * @returns Promesa con el arreglo de pagos no notificados.
   */
  findUnsetPayment(): Promise<Payment[]> {
    return this.paymentQueryService.findUnsetPayment();
  }

  /**
   * Marca un conjunto de pagos como notificados asignando la fecha/hora actual en `sendAt`.
   *
   * @param payments - Arreglo de entidades de pago a actualizar.
   * @returns Promesa que indica `true` si la actualización fue exitosa, o `false` en caso de error.
   */
  markPaymentsAsSent(payments: Payment[]): Promise<boolean> {
    return this.paymentStateService.markPaymentsAsSent(payments);
  }
}
