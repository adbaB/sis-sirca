import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Person } from '../../persons/entities/person.entity';

export enum PlanStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('plans')
@Check('CHK_plans_commission_amount', '"commission_amount" >= 0')
@Check('CK_plans_status', "\"status\" IN ('ACTIVE', 'INACTIVE')")
@Check('CHK_plans_coverage', '"coverage" >= 0')
@Check('CHK_plans_min_months', '"min_months" >= 2')
@Check('CHK_plans_min_age', '"min_age" >= 0')
@Check('CHK_plans_age_range', '"max_age" >= "min_age"')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'int', name: 'max_age' })
  maxAge: number;

  @Column({ type: 'int', name: 'min_age', default: 0 })
  minAge: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, name: 'commission_amount' })
  commissionAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  coverage: number;

  @Column({ type: 'int', name: 'min_months', default: 2 })
  minMonths: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: PlanStatus.ACTIVE,
  })
  status: PlanStatus;

  @OneToMany('Person', (person: Person) => person.plan)
  persons: Person[];

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
