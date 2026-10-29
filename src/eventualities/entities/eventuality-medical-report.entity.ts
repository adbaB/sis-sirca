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

  @Column({ type: 'varchar', length: 15, name: 'primary_cie10_code', nullable: true })
  primaryCie10Code?: string | null;

  @Column({ type: 'jsonb', name: 'secondary_cie10_codes', default: '[]' })
  secondaryCie10Codes?: Array<{ code: string; description: string }>;

  @Column({ type: 'text', name: 'reason_for_consultation', nullable: true })
  reasonForConsultation?: string | null;

  @Column({ type: 'text', name: 'current_illness', nullable: true })
  currentIllness?: string | null;

  @Column({ type: 'text', name: 'physical_exam', nullable: true })
  physicalExam?: string | null;

  @Column({ type: 'text', name: 'general_treatment_notes', nullable: true })
  generalTreatmentNotes?: string | null;

  @Column({ type: 'uuid', name: 'doctor_id', nullable: true })
  doctorId?: string | null;

  @Column({ type: 'timestamptz', name: 'signed_at', nullable: true })
  signedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
