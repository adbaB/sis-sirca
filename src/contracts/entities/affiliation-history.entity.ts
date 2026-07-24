import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Contract } from './contract.entity';
import type { Person } from '../../persons/entities/person.entity';
import type { Plan } from '../../plans/entities/plan.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';

@Entity('affiliation_history')
@Index('IDX_ah_action', ['action'])
@Index('IDX_ah_person', ['person'])
@Index('IDX_ah_contract', ['contract'])
@Index('IDX_ah_action_date', ['actionDate'])
@Check('CHK_ah_action', "\"action\" IN ('AFILIACION', 'DESAFILIACION', 'CAMBIO_CONTRATO')")
export class AffiliationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Contract', { nullable: false })
  @JoinColumn({ name: 'contract_id', foreignKeyConstraintName: 'FK_ah_contract' })
  contract: Contract;

  @ManyToOne('Person', { nullable: false })
  @JoinColumn({ name: 'person_id', foreignKeyConstraintName: 'FK_ah_person' })
  person: Person;

  @ManyToOne('Plan', { nullable: true })
  @JoinColumn({ name: 'plan_id', foreignKeyConstraintName: 'FK_ah_plan' })
  plan: Plan;

  @Column({ type: 'varchar', length: 30 })
  action: AffiliationAction;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string;

  @Column({ type: 'uuid', name: 'performed_by', nullable: true })
  performedBy: string;

  @Column({ type: 'timestamp', name: 'action_date', default: () => 'now()' })
  actionDate: Date;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
