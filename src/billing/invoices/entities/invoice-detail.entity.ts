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
import type { Person } from '../../../persons/entities/person.entity';
import type { Plan } from '../../../plans/entities/plan.entity';
import type { Invoice } from './invoice.entity';

/**
 * @deprecated Usar {@link InvoiceLine} (tabla `invoice_lines`) en su lugar.
 *
 * Esta entidad y la tabla `invoice_details` se mantienen exclusivamente para
 * compatibilidad con datos históricos. No deben usarse para nueva lógica de
 * negocio ni en nuevos reportes.
 *
 * Migración: `1781400000000-add-invoice-lines-and-affiliation-history`
 * - Los datos existentes fueron copiados a `invoice_lines` con `category = 'MENSUALIDAD'`.
 * - La relación `invoice.lines` reemplaza a `invoice.details`.
 */
@Entity('invoice_details')
export class InvoiceDetail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Invoice', (invoice: Invoice) => invoice.details, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @ManyToOne('Person', { nullable: false })
  @JoinColumn({ name: 'person_id' })
  person: Person;

  @ManyToOne('Plan', { nullable: false })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'charged_amount' })
  chargedAmount: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
