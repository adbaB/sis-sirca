import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Person } from '../../../persons/entities/person.entity';
import type { Invoice } from '../../invoices/entities/invoice.entity';
import { Surplus } from './surplus.entity';
import {
  decimalTransformer,
  nullableDecimalTransformer,
} from '../../../common/transformers/decimal.transformer';

/**
 * Estado actual del procesamiento del pago.
 */
export enum PaymentStatus {
  /** Pago registrado en revisión/procesamiento por parte de administración. */
  PROCESSING = 'PROCESSING',
  /** Pago verificado y approved exitosamente. */
  COMPLETED = 'COMPLETED',
  /** Pago rechazado debido a inconsistencias o referencias inválidas. */
  REJECTED = 'REJECTED',
}

/**
 * Canal u origen desde donde fue registrado el pago.
 */
export enum PaymentOrigin {
  /** Registrado desde el panel web administrativo o de usuario. */
  WEB = 'WEB',
  /** Registrado automáticamente a través de la interacción con el Bot. */
  BOT = 'BOT',
}

/**
 * Entidad TypeORM que representa la tabla `payments` en la base de datos.
 * Registra los pagos efectuados contra las facturas del sistema.
 */
@Entity('payments')
@Index('IDX_payments_invoice_id', ['invoice'])
@Index('IDX_payments_person_id', ['person'])
@Index('IDX_payments_reference_number', ['referenceNumber'])
@Index('IDX_payments_payment_date', ['paymentDate'])
@Index('IDX_payments_status_send_at', ['status', 'sendAt'])
export class Payment {
  /** Identificador único UUID del pago. */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Factura asociada a la cual se le aplica el pago. */
  @ManyToOne('Invoice', (invoice: Invoice) => invoice.payments, { nullable: false })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  /** Persona asociada que realizó el pago (opcional). */
  @ManyToOne('Person', { nullable: true })
  @JoinColumn({ name: 'person_id' })
  person?: Person | null;

  /** Fecha de emisión del recibo de pago reportado por el usuario/banco. */
  @Column({ type: 'timestamptz', name: 'payment_date' })
  paymentDate: Date;

  /** Fecha en la que el sistema procesó operacionalmente la transacción. */
  @Column({ type: 'timestamptz', name: 'operation_date', nullable: true })
  operationDate?: Date | null;

  /** Canal de origen del pago (WEB o BOT). */
  @Column({ type: 'varchar', length: 20, name: 'origin', default: PaymentOrigin.WEB })
  origin: PaymentOrigin;

  /** Monto abonado a la factura expresado en USD. */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
    name: 'amount',
  })
  amount: number;

  /** Monto abonado a la factura expresado en Bolívares (Bs) si el pago fue en moneda local. */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: nullableDecimalTransformer,
    name: 'amount_bs',
    nullable: true,
  })
  amountBs: number | null;

  /** URL del comprobante de pago almacenado en la nube (AWS S3). */
  @Column({ type: 'varchar', length: 255, name: 'url', nullable: true })
  url?: string | null;

  /** Método de pago utilizado (e.g. ZELLE, PAGO_MOVIL, TRANSFERENCIA). */
  @Column({ type: 'varchar', length: 50, name: 'payment_method' })
  paymentMethod: string;

  /** Número de referencia bancario único de la transacción. */
  @Column({ type: 'varchar', length: 100, name: 'reference_number' })
  referenceNumber: string;

  /** Estado actual de aprobación del pago (PROCESSING, COMPLETED, REJECTED). */
  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PROCESSING })
  status: PaymentStatus;

  /** Fecha y hora en la que se envió la notificación/reporte de pago (si aplica). */
  @Column({ type: 'timestamptz', name: 'send_at', nullable: true })
  sendAt?: Date | null;

  /** Metadatos arbitrarios en formato JSON (motivos de rechazo, detalles de OCR, etc.). */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /** Excedentes/saldos a favor generados a partir de este pago. */
  @OneToMany('Surplus', (surplus: Surplus) => surplus.payment)
  surpluses: Surplus[];

  /** Fecha de creación del registro en base de datos. */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  /** Fecha de última actualización del registro. */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  /** Fecha de eliminación lógica (Soft Delete). */
  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date;
}
