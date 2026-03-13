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
import type { Plan } from '../../plans/entities/plan.entity';
import type { Contract } from '../../contracts/entities/contract.entity';

@Entity('persons')
export class Person {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true, name: 'identity_card' })
  identityCard: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'date', name: 'birth_date' })
  birthDate: Date;

  @Column({ type: 'varchar', length: 20 })
  gender: string;

  @ManyToOne('Plan', (plan: Plan) => plan.persons)
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @ManyToOne('Contract', (contract: Contract) => contract.persons, { nullable: true })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
