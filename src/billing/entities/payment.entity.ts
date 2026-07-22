import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Person } from '../../persons/entities/person.entity';
import type { Invoice } from '../invoices/entities/invoice.entity';
import { Surplus } from './surplus.entity';

export enum PaymentStatus {
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Invoice', (invoice: Invoice) => invoice.payments, { nullable: false })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @ManyToOne('Person', { nullable: true })
  @JoinColumn({ name: 'person_id' })
  person?: Person | null;

  @Column({ type: 'timestamp', name: 'payment_date' })
  paymentDate: Date;

  @Column({ type: 'timestamp', name: 'operation_date', nullable: true })
  operationDate?: Date | null;

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

  @Column({ type: 'timestamp', name: 'send_at', nullable: true })
  sendAt?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @OneToMany('Surplus', (surplus: Surplus) => surplus.payment)
  surpluses: Surplus[];

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
