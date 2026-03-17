import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Contract } from '../../contracts/entities/contract.entity';
import type { InvoiceDetail } from './invoice-detail.entity';
import type { Payment } from './payment.entity';

export enum InvoiceStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

@Entity('invoices')
@Check('"total_amount" >= 0')
@Check('"paid_amount" >= 0')
@Check('"paid_amount" <= "total_amount"')
@Unique(['contract', 'billingMonth'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Contract', (contract: Contract) => contract.invoices, { nullable: false })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'varchar', length: 7, name: 'billing_month' })
  billingMonth: string;

  @Column({ type: 'date', name: 'issue_date' })
  issueDate: Date;

  @Column({ type: 'date', name: 'due_date' })
  dueDate: Date;

const decimalTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

// ... other entity code ...

  `@Column`({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'total_amount',
    transformer: decimalTransformer,
  })
  totalAmount: number;

  `@Column`({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    name: 'paid_amount',
    transformer: decimalTransformer,
  })
  paidAmount: number;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.PENDING })
  status: InvoiceStatus;

  @OneToMany('InvoiceDetail', (detail: InvoiceDetail) => detail.invoice, { cascade: true })
  details: InvoiceDetail[];

  @OneToMany('Payment', (payment: Payment) => payment.invoice)
  payments: Payment[];

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
