import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Eventuality } from '../../eventualities/entities/eventuality.entity';
import type { MedicalService } from '../../plans/entities/medical-service.entity';

export interface DoctorDaySchedule {
  readonly dayOfWeek: number; // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  readonly enabled: boolean;
  readonly startTime: string; // 'HH:mm'
  readonly endTime: string; // 'HH:mm'
}

@Entity('doctors')
@Check(
  'CHK_doctors_consultation_duration',
  '"consultation_duration_minutes" >= 5 AND "consultation_duration_minutes" <= 240',
)
@Check(
  'CHK_doctors_max_daily',
  '"max_daily_consultations" IS NULL OR "max_daily_consultations" >= 1',
)
@Check(
  'CHK_doctors_max_weekly',
  '"max_weekly_consultations" IS NULL OR "max_weekly_consultations" >= 1',
)
@Check(
  'CHK_doctors_max_monthly',
  '"max_monthly_consultations" IS NULL OR "max_monthly_consultations" >= 1',
)
export class Doctor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, name: 'first_name' })
  firstName: string;

  @Column({ type: 'varchar', length: 100, name: 'last_name' })
  lastName: string;

  @Column({ type: 'varchar', length: 10, default: 'V', name: 'type_identity_card' })
  typeIdentityCard: string;

  @Index('IDX_doctors_identity_card', { unique: true })
  @Column({ type: 'varchar', length: 30, unique: true, name: 'identity_card' })
  identityCard: string;

  @Column({ type: 'date', nullable: true, name: 'graduation_date' })
  graduationDate: string | null;

  @Column({ type: 'varchar', length: 150 })
  specialty: string;

  @Column({ type: 'varchar', length: 50 })
  mpps: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  comezu: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true, name: 'digital_signature_url' })
  digitalSignatureUrl: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'boolean', default: true, name: 'can_attend_aps' })
  canAttendAps: boolean;

  @Column({ type: 'boolean', default: true, name: 'can_schedule_consultations' })
  canScheduleConsultations: boolean;

  @Column({ type: 'boolean', default: false, name: 'is_medical_auditor' })
  isMedicalAuditor: boolean;

  @Column({ type: 'integer', default: 30, name: 'consultation_duration_minutes' })
  consultationDurationMinutes: number;

  @Column({ type: 'integer', nullable: true, name: 'max_daily_consultations' })
  maxDailyConsultations: number | null;

  @Column({ type: 'integer', nullable: true, name: 'max_weekly_consultations' })
  maxWeeklyConsultations: number | null;

  @Column({ type: 'integer', nullable: true, name: 'max_monthly_consultations' })
  maxMonthlyConsultations: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb", name: 'weekly_schedule' })
  weeklySchedule: DoctorDaySchedule[];

  @Index('IDX_doctors_default_medical_service_id')
  @Column({ type: 'uuid', nullable: true, name: 'default_medical_service_id' })
  defaultMedicalServiceId: string | null;

  @ManyToOne('MedicalService', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'default_medical_service_id',
    foreignKeyConstraintName: 'FK_doctors_default_medical_service',
  })
  defaultMedicalService?: MedicalService | null;

  @OneToMany('Eventuality', 'doctor')
  eventualities?: Eventuality[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
