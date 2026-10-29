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
import type { Eventuality } from './eventuality.entity';

@Entity('eventuality_treatment_items')
export class EventualityTreatmentItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_treatment_items_eventuality_id')
  @Column({ type: 'uuid', name: 'eventuality_id' })
  eventualityId: string;

  @ManyToOne('Eventuality', { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'eventuality_id',
    foreignKeyConstraintName: 'FK_treatment_items_eventuality',
  })
  eventuality?: Eventuality;

  @Column({ type: 'varchar', length: 255, name: 'medication_name' })
  medicationName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  presentation?: string | null;

  @Column({ type: 'varchar', length: 150 })
  dosage: string;

  @Column({ type: 'varchar', length: 150 })
  frequency: string;

  @Column({ type: 'varchar', length: 150 })
  duration: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'administration_route' })
  administrationRoute?: string | null;

  @Column({ type: 'text', nullable: true })
  instructions?: string | null;

  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
