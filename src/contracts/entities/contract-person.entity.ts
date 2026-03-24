import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Contract } from './contract.entity';
import type { Person } from '../../persons/entities/person.entity';

export enum PersonRole {
  TITULAR = 'TITULAR',
  AFILIADO = 'AFILIADO',
}

@Entity('contract_persons')
@Unique(['contract', 'person'])
export class ContractPerson {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Contract', (contract: Contract) => contract.contractPersons, { nullable: false })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @ManyToOne('Person', (person: Person) => person.contractPersons, { nullable: false })
  @JoinColumn({ name: 'person_id' })
  person: Person;

  @Column({ type: 'enum', enum: PersonRole, default: PersonRole.AFILIADO })
  role: PersonRole;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
