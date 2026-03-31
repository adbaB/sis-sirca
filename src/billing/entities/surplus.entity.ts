import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Payment } from './payment.entity';
import { Invoice } from './invoice.entity';
import { Contract } from '../../contracts/entities/contract.entity';

export enum SurplusStatus {
  PENDING = 'pending',
  APPLIED = 'applied',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
}

@Entity('surpluses')
export class Surplus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'amount_bs', nullable: true })
  amountBs: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'amount_usd', nullable: true })
  amountUsd: number | null;

  @Column({ type: 'timestamp', name: 'date' })
  date: Date;

  @ManyToOne(() => Payment, { nullable: false })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice | null;

  @ManyToOne(() => Contract, { nullable: false })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'enum', enum: SurplusStatus, default: SurplusStatus.PENDING })
  status: SurplusStatus;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
