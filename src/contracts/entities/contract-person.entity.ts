import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Contract } from './contract.entity';
import type { Person } from '../../persons/entities/person.entity';
import type { HealthDeclaration } from './health-declaration.entity';

export enum PersonRole {
  TITULAR = 'TITULAR',
  AFILIADO = 'AFILIADO',
}

export enum Parentesco {
  PADRE = 'PADRE',
  MADRE = 'MADRE',
  HIJO = 'HIJO',
  HIJA = 'HIJA',
  HERMANO = 'HERMANO',
  HERMANA = 'HERMANA',
  ESPOSO = 'ESPOSO',
  ESPOSA = 'ESPOSA',
  ABUELO = 'ABUELO',
  ABUELA = 'ABUELA',
  TIO = 'TIO',
  TIA = 'TIA',
  SOBRINO = 'SOBRINO',
  SOBRINA = 'SOBRINA',
  PRIMO = 'PRIMO',
  PRIMA = 'PRIMA',
  OTRO = 'OTRO',
}

@Entity('contract_persons')
@Index('UQ_contract_person_active', ['contract', 'person'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
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

  @Column({ type: 'enum', enum: Parentesco, nullable: true })
  relationship?: Parentesco;

  @Column({ type: 'boolean', default: false, name: 'is_billing_owner' })
  isBillingOwner: boolean;

  @OneToMany('HealthDeclaration', (hd: HealthDeclaration) => hd.contractPerson)
  healthDeclarations?: HealthDeclaration[];

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
