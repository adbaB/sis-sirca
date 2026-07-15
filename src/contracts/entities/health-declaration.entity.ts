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
import type { ContractPerson } from './contract-person.entity';

export enum HealthCategory {
  CARDIOVASCULAR = 'CARDIOVASCULAR',
  RESPIRATORIA = 'RESPIRATORIA',
  DIGESTIVA = 'DIGESTIVA',
  ENDOCRINA = 'ENDOCRINA',
  OSTEOMUSCULAR = 'OSTEOMUSCULAR',
  GENITOURINARIA = 'GENITOURINARIA',
  PIEL_OJOS_OIDOS = 'PIEL_OJOS_OIDOS',
  CRONICA_TRANSITORIA = 'CRONICA_TRANSITORIA',
  GINECOLOGICA = 'GINECOLOGICA',
  QUIRURGICA = 'QUIRURGICA',
  OTROS = 'OTROS',
}

@Entity('health_declarations')
export class HealthDeclaration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne('ContractPerson', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_person_id' })
  contractPerson: ContractPerson;

  @Column({ type: 'enum', enum: HealthCategory, nullable: false })
  category: HealthCategory;

  @Column({ type: 'boolean', name: 'has_condition', default: false })
  hasCondition: boolean;

  @Column({ type: 'text', name: 'affected_persons', nullable: true })
  affectedPersons?: string;

  @Column({ type: 'text', nullable: true })
  details?: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
