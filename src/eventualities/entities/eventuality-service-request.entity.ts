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
import type { Person } from '../../persons/entities/person.entity';
import type { ContractPerson } from '../../contracts/entities/contract-person.entity';
import type { Doctor } from '../../doctors/entities/doctor.entity';
import type { MedicalService } from '../../plans/entities/medical-service.entity';

export enum ServiceRequestType {
  LABORATORY = 'LABORATORY',
  IMAGING = 'IMAGING',
  SPECIAL_STUDY = 'SPECIAL_STUDY',
  CONSULTATION = 'CONSULTATION',
  HOSPITALIZATION = 'HOSPITALIZATION',
}

export enum ServiceRequestStatus {
  PENDING = 'PENDING',
  CONVERTED = 'CONVERTED',
  CANCELLED = 'CANCELLED',
}

@Entity('eventuality_service_requests')
export class EventualityServiceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_service_requests_eventuality_id')
  @Column({ type: 'uuid', name: 'eventuality_id' })
  eventualityId: string;

  @ManyToOne('Eventuality', { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'eventuality_id',
    foreignKeyConstraintName: 'FK_service_requests_eventuality',
  })
  eventuality?: Eventuality;

  @Index('IDX_service_requests_person_id')
  @Column({ type: 'uuid', name: 'person_id' })
  personId: string;

  @ManyToOne('Person', { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'person_id',
    foreignKeyConstraintName: 'FK_service_requests_person',
  })
  person?: Person;

  @Index('IDX_service_requests_contract_person_id')
  @Column({ type: 'uuid', name: 'contract_person_id' })
  contractPersonId: string;

  @ManyToOne('ContractPerson', { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'contract_person_id',
    foreignKeyConstraintName: 'FK_service_requests_contract_person',
  })
  contractPerson?: ContractPerson;

  @Index('IDX_service_requests_doctor_id')
  @Column({ type: 'uuid', name: 'doctor_id', nullable: true })
  doctorId?: string | null;

  @ManyToOne('Doctor', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'doctor_id',
    foreignKeyConstraintName: 'FK_service_requests_doctor',
  })
  doctor?: Doctor | null;

  @Index('IDX_service_requests_type')
  @Column({
    type: 'varchar',
    length: 30,
    name: 'request_type',
  })
  requestType: ServiceRequestType;

  @Index('IDX_service_requests_status')
  @Column({
    type: 'varchar',
    length: 30,
    default: ServiceRequestStatus.PENDING,
  })
  status: ServiceRequestStatus;

  @Index('IDX_service_requests_medical_service_id')
  @Column({ type: 'uuid', name: 'medical_service_id', nullable: true })
  medicalServiceId?: string | null;

  @ManyToOne('MedicalService', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'medical_service_id',
    foreignKeyConstraintName: 'FK_service_requests_medical_service',
  })
  medicalService?: MedicalService | null;

  @Column({ type: 'varchar', length: 255, name: 'service_name' })
  serviceName: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  specialty?: string | null;

  @Column({ type: 'text', nullable: true, name: 'clinical_justification' })
  clinicalJustification?: string | null;

  @Column({ type: 'varchar', length: 20, default: 'NORMAL' })
  priority: 'NORMAL' | 'URGENT';

  @Index('IDX_service_requests_child_eventuality_id')
  @Column({ type: 'uuid', name: 'child_eventuality_id', nullable: true })
  childEventualityId?: string | null;

  @ManyToOne('Eventuality', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'child_eventuality_id',
    foreignKeyConstraintName: 'FK_service_requests_child_eventuality',
  })
  childEventuality?: Eventuality | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'converted_at' })
  convertedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
