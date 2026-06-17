import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Invoice } from './invoice.entity';
import type { Person } from '../../persons/entities/person.entity';
import type { Plan } from '../../plans/entities/plan.entity';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';

@Entity('invoice_lines')
export class InvoiceLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Invoice', (invoice: Invoice) => invoice.lines, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'varchar', length: 30, default: InvoiceLineCategory.MENSUALIDAD })
  category: InvoiceLineCategory;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @ManyToOne('Person', { nullable: true })
  @JoinColumn({ name: 'person_id' })
  person: Person;

  @ManyToOne('Plan', { nullable: true })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ type: 'boolean', default: false, name: 'is_projectable' })
  isProjectable: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
