import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Person } from '../../persons/entities/person.entity';
import type { ContractPerson } from '../../contracts/entities/contract-person.entity';
import type { ContractCoveragePeriod } from '../../contracts/entities/contract-coverage-period.entity';
import type { EventualityExtractionDetail } from './eventuality-extraction-detail.entity';
import type { EventualityMedicalReport } from './eventuality-medical-report.entity';
import type { EventualityMovement } from './eventuality-movement.entity';
import type { EventualityProviderInvoice } from './eventuality-provider-invoice.entity';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

export enum EventualityType {
  EMERGENCY = 'EMERGENCY',
  HOSPITALIZATION = 'HOSPITALIZATION',
  APS = 'APS',
  CONSULTATION = 'CONSULTATION',
  STUDY = 'STUDY',
}

export enum EventualityStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  CLINIC_PROCESS = 'CLINIC_PROCESS',
  DOCTOR_QUEUE = 'DOCTOR_QUEUE',
  SCHEDULED = 'SCHEDULED',
  WAITING_INVOICE = 'WAITING_INVOICE',
  UNDER_ADMIN_REVIEW = 'UNDER_ADMIN_REVIEW',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

@Entity('eventualities')
@Index('UQ_eventualities_claim_number', ['claimNumber'], {
  unique: true,
  where: `"claim_number" IS NOT NULL`,
})
@Index('IDX_eventualities_person_id', ['person'])
@Index('IDX_eventualities_contract_person_id', ['contractPerson'])
@Index('IDX_eventualities_coverage_period_id', ['coveragePeriod'])
@Index('IDX_eventualities_parent_id', ['parentEventuality'])
@Index('IDX_eventualities_type_status', ['type', 'status'])
@Index('IDX_eventualities_created_at', ['createdAt'])
@Check(
  'CHK_eventualities_type',
  `"type" IN ('EMERGENCY', 'HOSPITALIZATION', 'APS', 'CONSULTATION', 'STUDY')`,
)
@Check(
  'CHK_eventualities_status',
  `"status" IN ('PENDING_APPROVAL', 'CLINIC_PROCESS', 'DOCTOR_QUEUE', 'SCHEDULED', 'WAITING_INVOICE', 'UNDER_ADMIN_REVIEW', 'CLOSED', 'CANCELLED', 'REJECTED')`,
)
@Check('CHK_eventualities_total_cost', '"total_cost" >= 0')
@Check('CHK_eventualities_total_coverage', '"total_coverage_deducted" >= 0')
@Check('CHK_eventualities_reserved_coverage', '"reserved_coverage_amount" >= 0')
export class Eventuality {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, name: 'claim_number', nullable: true })
  claimNumber?: string | null;

  @Column({ type: 'varchar', length: 30 })
  type: EventualityType;

  @Column({ type: 'varchar', length: 30 })
  status: EventualityStatus;

  @ManyToOne('Person', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'person_id', foreignKeyConstraintName: 'FK_eventualities_person' })
  person: Person;

  @Column({ type: 'uuid', name: 'person_id' })
  personId: string;

  @ManyToOne('ContractPerson', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'contract_person_id',
    foreignKeyConstraintName: 'FK_eventualities_contract_person',
  })
  contractPerson: ContractPerson;

  @Column({ type: 'uuid', name: 'contract_person_id' })
  contractPersonId: string;

  @ManyToOne('ContractCoveragePeriod', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'coverage_period_id',
    foreignKeyConstraintName: 'FK_eventualities_coverage_period',
  })
  coveragePeriod: ContractCoveragePeriod;

  @Column({ type: 'uuid', name: 'coverage_period_id' })
  coveragePeriodId: string;

  @ManyToOne('Eventuality', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'parent_eventuality_id',
    foreignKeyConstraintName: 'FK_eventualities_parent',
  })
  parentEventuality?: Eventuality | null;

  @Column({ type: 'uuid', name: 'parent_eventuality_id', nullable: true })
  parentEventualityId?: string | null;

  @Column({ type: 'text', name: 'clinic_name', nullable: true })
  clinicName?: string | null;

  @Column({ type: 'timestamptz', name: 'admission_date', nullable: true })
  admissionDate?: Date | null;

  @Column({ type: 'timestamptz', name: 'discharge_date', nullable: true })
  dischargeDate?: Date | null;

  @Column({ type: 'text', name: 'medical_report_url', nullable: true })
  medicalReportUrl?: string | null;

  @Column({ type: 'text', name: 'medical_report_notes', nullable: true })
  medicalReportNotes?: string | null;

  @Column({ type: 'text', name: 'consumption_pdf_url', nullable: true })
  consumptionPdfUrl?: string | null;

  @Column({ type: 'varchar', length: 10, name: 'consumption_currency', nullable: true })
  consumptionCurrency?: 'USD' | 'Bs' | null;

  @Column({ type: 'date', name: 'exchange_rate_date', nullable: true })
  exchangeRateDate?: string | Date | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'applied_exchange_rate',
    nullable: true,
    transformer: decimalTransformer,
  })
  appliedExchangeRate?: number | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 2.0,
    name: 'applied_factor',
    transformer: decimalTransformer,
  })
  appliedFactor: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'total_cost',
    transformer: decimalTransformer,
  })
  totalCost: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'total_coverage_deducted',
    transformer: decimalTransformer,
  })
  totalCoverageDeducted: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'reserved_coverage_amount',
    transformer: decimalTransformer,
  })
  reservedCoverageAmount: number;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt?: Date | null;

  @Column({ type: 'boolean', default: false, name: 'requires_approval' })
  requiresApproval: boolean;

  @Column({ type: 'timestamptz', name: 'approved_at', nullable: true })
  approvedAt?: Date | null;

  @Column({ type: 'varchar', length: 255, name: 'approved_by', nullable: true })
  approvedBy?: string | null;

  @Column({ type: 'text', name: 'rejection_reason', nullable: true })
  rejectionReason?: string | null;

  @OneToMany('EventualityExtractionDetail', (item: EventualityExtractionDetail) => item.eventuality)
  extractionDetails?: EventualityExtractionDetail[];

  @OneToOne('EventualityMedicalReport', (report: EventualityMedicalReport) => report.eventuality)
  medicalReport?: EventualityMedicalReport | null;

  @OneToMany('EventualityMovement', (movement: EventualityMovement) => movement.eventuality)
  movements?: EventualityMovement[];

  @OneToMany('EventualityProviderInvoice', (inv: EventualityProviderInvoice) => inv.eventuality)
  providerInvoices?: EventualityProviderInvoice[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt?: Date | null;
}
