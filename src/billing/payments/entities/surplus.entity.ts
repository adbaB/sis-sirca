import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Contract } from '../../../contracts/entities/contract.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { Payment } from './payment.entity';
import { decimalTransformer } from '../../../common/transformers/decimal.transformer';

/**
 * Estados del saldo a favor / excedente de pago.
 */
export enum SurplusStatus {
  /** Excedente disponible pendiente por aplicar a futuras facturas. */
  PENDING = 'pending',
  /** Excedente ya consumido e imputado a una factura. */
  APPLIED = 'applied',
  /** Excedente reembolsado al cliente. */
  REFUNDED = 'refunded',
  /** Excedente anulado/cancelado (e.g. al rechazar o modificar el pago original). */
  CANCELLED = 'cancelled',
}

/**
 * Estados a los que un operador administrativo puede cambiar un excedente manualmente.
 * El estado `APPLIED` es inmutable manualmente y sólo se alcanza mediante imputación a factura.
 */
export type MutableSurplusStatus = Exclude<SurplusStatus, SurplusStatus.APPLIED>;

/**
 * Matriz estricta de transiciones de estado permitidas para excedentes.
 */
export const ALLOWED_SURPLUS_TRANSITIONS: Readonly<
  Record<SurplusStatus, readonly MutableSurplusStatus[]>
> = {
  [SurplusStatus.PENDING]: [SurplusStatus.REFUNDED, SurplusStatus.CANCELLED],
  [SurplusStatus.REFUNDED]: [SurplusStatus.PENDING, SurplusStatus.CANCELLED],
  [SurplusStatus.CANCELLED]: [SurplusStatus.PENDING, SurplusStatus.REFUNDED],
  [SurplusStatus.APPLIED]: [],
} as const;

/**
 * Type guard que valida en runtime y acota en tiempo de compilación si una transición de estado es válida.
 */
export function isValidSurplusTransition(
  currentStatus: SurplusStatus,
  targetStatus: SurplusStatus,
): targetStatus is MutableSurplusStatus {
  const allowed = ALLOWED_SURPLUS_TRANSITIONS[currentStatus];
  return (allowed as readonly SurplusStatus[]).includes(targetStatus);
}

/**
 * Entidad TypeORM que representa la tabla `surpluses` en la base de datos.
 * Almacena los excedentes o saldos a favor generados por sobrepagos en facturas.
 */
@Entity('surpluses')
@Index('IDX_surpluses_contract_id', ['contract'])
@Index('IDX_surpluses_payment_id', ['payment'])
@Index('IDX_surpluses_invoice_id', ['invoice'])
@Index('IDX_surpluses_status', ['status'])
export class Surplus {
  /** Identificador único UUID del excedente. */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Monto sobrante en Bolívares (Bs), si aplica. */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'amount_bs',
    nullable: true,
    transformer: decimalTransformer,
  })
  amountBs: number | null;

  /** Monto sobrante en dólares (USD), si aplica. */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'amount_usd',
    nullable: true,
    transformer: decimalTransformer,
  })
  amountUsd: number | null;

  /** Fecha de registro del excedente. */
  @Column({ type: 'timestamptz', name: 'date' })
  date: Date;

  /** Pago original que dio origen al excedente. */
  @ManyToOne(() => Payment, { nullable: false })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;

  /** Factura a la que fue aplicado el excedente (null mientras esté PENDING). */
  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice | null;

  /** Contrato titular al que pertenece el saldo a favor. */
  @ManyToOne(() => Contract, { nullable: false })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  /** Estado actual del excedente (pending, applied, refunded, cancelled). */
  @Column({ type: 'enum', enum: SurplusStatus, default: SurplusStatus.PENDING })
  status: SurplusStatus;

  /** Metadatos arbitrarios en formato JSON (motivos de cambio de estado, trazabilidad, etc.). */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /** Fecha de creación en base de datos. */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  /** Fecha de última modificación del registro. */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
