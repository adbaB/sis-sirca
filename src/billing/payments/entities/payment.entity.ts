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

export enum PaymentStatus {
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

export enum PaymentOrigin {
  WEB = 'WEB',
  BOT = 'BOT',
}

@Entity('payments')
@Index('IDX_payments_invoice_id', ['invoice'])
@Index('IDX_payments_person_id', ['person'])
@Index('IDX_payments_reference_number', ['referenceNumber'])
@Index('IDX_payments_payment_date', ['paymentDate'])
@Index('IDX_payments_status', ['status'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Invoice', (invoice: Invoice) => invoice.payments, { nullable: false })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @ManyToOne('Person', { nullable: true })
  @JoinColumn({ name: 'person_id' })
  person?: Person | null;

  @Column({ type: 'timestamptz', name: 'payment_date' })
  paymentDate: Date;

  @Column({ type: 'timestamptz', name: 'operation_date', nullable: true })
  operationDate?: Date | null;

  @Column({ type: 'varchar', length: 20, name: 'origin', default: PaymentOrigin.WEB })
  origin: PaymentOrigin;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'amount_bs', nullable: true })
  amountBs: number;

  @Column({ type: 'varchar', length: 255, name: 'url', nullable: true })
  url?: string | null;

  @Column({ type: 'varchar', length: 50, name: 'payment_method' })
  paymentMethod: string;

  @Column({ type: 'varchar', length: 100, name: 'reference_number' })
  referenceNumber: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PROCESSING })
  status: PaymentStatus;

  @Column({ type: 'timestamptz', name: 'send_at', nullable: true })
  sendAt?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @OneToMany('Surplus', (surplus: Surplus) => surplus.payment)
  surpluses: Surplus[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date;
}
