import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Eventuality } from './eventuality.entity';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

@Entity('eventuality_provider_invoices')
@Index('IDX_epi_eventuality_id', ['eventuality'])
@Index('IDX_epi_invoice_number', ['invoiceNumber'])
@Check('CHK_epi_subtotal', '"subtotal_amount" >= 0')
@Check('CHK_epi_tax', '"tax_amount" >= 0')
@Check('CHK_epi_total', '"total_amount" >= 0')
export class EventualityProviderInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Eventuality', (evt: Eventuality) => evt.providerInvoices, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'eventuality_id', foreignKeyConstraintName: 'FK_epi_eventuality' })
  eventuality: Eventuality;

  @Column({ type: 'uuid', name: 'eventuality_id' })
  eventualityId: string;

  @Column({ type: 'text', name: 'provider_name' })
  providerName: string;

  @Column({ type: 'varchar', length: 50, name: 'provider_rif', nullable: true })
  providerRif?: string | null;

  @Column({ type: 'varchar', length: 100, name: 'invoice_number' })
  invoiceNumber: string;

  @Column({ type: 'varchar', length: 100, name: 'control_number', nullable: true })
  controlNumber?: string | null;

  @Column({ type: 'date', name: 'invoice_date' })
  invoiceDate: Date;

  @Column({ type: 'text', name: 'invoice_pdf_url', nullable: true })
  invoicePdfUrl?: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'subtotal_amount',
    transformer: decimalTransformer,
  })
  subtotalAmount: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'tax_amount',
    transformer: decimalTransformer,
  })
  taxAmount: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'total_amount',
    transformer: decimalTransformer,
  })
  totalAmount: number;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt?: Date | null;
}
