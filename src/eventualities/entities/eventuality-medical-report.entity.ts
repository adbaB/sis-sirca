import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Eventuality } from './eventuality.entity';

export enum MedicalReportExtractionStatus {
  PROCESSING = 'PROCESSING',
  EXTRACTED = 'EXTRACTED',
  EDITED = 'EDITED',
  FAILED = 'FAILED',
}

@Entity('eventuality_medical_reports')
@Index('UQ_emr_eventuality_id', ['eventualityId'], { unique: true })
@Check('CHK_emr_status', `"status" IN ('PROCESSING', 'EXTRACTED', 'EDITED', 'FAILED')`)
export class EventualityMedicalReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne('Eventuality', (evt: Eventuality) => evt.medicalReport, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'eventuality_id' })
  eventuality: Eventuality;

  @Column({ type: 'uuid', name: 'eventuality_id', unique: true })
  eventualityId: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: MedicalReportExtractionStatus.PROCESSING,
  })
  status: MedicalReportExtractionStatus;

  @Column({ type: 'text', name: 'report_type', nullable: true })
  reportType?: string | null;

  @Column({ type: 'text', nullable: true })
  company?: string | null;

  @Column({ type: 'text', name: 'doctor_full_name', nullable: true })
  doctorFullName?: string | null;

  @Column({ type: 'varchar', length: 50, name: 'doctor_identity_card', nullable: true })
  doctorIdentityCard?: string | null;

  @Column({ type: 'varchar', length: 100, name: 'doctor_ms', nullable: true })
  doctorMs?: string | null;

  @Column({ type: 'varchar', length: 100, name: 'doctor_comezu', nullable: true })
  doctorComezu?: string | null;

  @Column({ type: 'text', name: 'doctor_specialty', nullable: true })
  doctorSpecialty?: string | null;

  @Column({ type: 'text', name: 'admission_diagnosis', nullable: true })
  admissionDiagnosis?: string | null;

  @Column({ type: 'text', name: 'medical_report', nullable: true })
  medicalReport?: string | null;

  @Column({ type: 'text', name: 'discharge_diagnosis', nullable: true })
  dischargeDiagnosis?: string | null;

  @Column({ type: 'varchar', length: 50, name: 'report_date', nullable: true })
  reportDate?: string | null;

  @Column({ type: 'varchar', length: 50, name: 'report_time', nullable: true })
  reportTime?: string | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
