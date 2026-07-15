import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import type { ContractPerson } from '../../contracts/entities/contract-person.entity';
import type { Plan } from '../../plans/entities/plan.entity';

export enum PersonStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum TypeIdentityCard {
  V = 'V',
  E = 'E',
  P = 'P',
  J = 'J',
  G = 'G',
  C = 'C',
  PN = 'PN',
}

import { nullableDecimalTransformer } from '../../common/transformers/decimal.transformer';

@Entity('persons')
@Unique(['typeIdentityCard', 'identityCard'])
export class Person {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: TypeIdentityCard, nullable: false, name: 'type_identity_card' })
  typeIdentityCard: TypeIdentityCard;

  @Column({ type: 'varchar', length: 50, name: 'identity_card', nullable: false })
  identityCard: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'date', name: 'birth_date', nullable: true })
  birthDate?: Date;

  @Column({ type: 'boolean', name: 'gender', nullable: true })
  gender?: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'alternate_phone' })
  alternatePhone?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state?: string;

  @Column({ type: 'varchar', length: 10, nullable: true, name: 'postal_code' })
  postalCode?: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  weight?: number;

  @Column({
    type: 'decimal',
    precision: 4,
    scale: 2,
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  height?: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  occupation?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'legal_representative' })
  legalRepresentative?: string;

  @ManyToOne('Plan', (plan: Plan) => plan.persons, { nullable: true })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @OneToMany('ContractPerson', (contractPerson: ContractPerson) => contractPerson.person)
  contractPersons: ContractPerson[];

  @Column({ type: 'enum', enum: PersonStatus, default: PersonStatus.ACTIVE })
  status?: PersonStatus;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt?: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt?: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt?: Date;
}
