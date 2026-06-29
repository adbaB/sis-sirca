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
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'int', name: 'max_age' })
  maxAge: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, name: 'commission_amount' })
  commissionAmount: number;

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
