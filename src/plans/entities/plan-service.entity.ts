import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Plan } from './plan.entity';
import type { MedicalService } from './medical-service.entity';

export enum PlanServiceLimitType {
  UNLIMITED = 'UNLIMITED',
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
}

@Entity('plan_services')
@Index('UQ_plan_services_plan_medical_service_active', ['planId', 'medicalServiceId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('IDX_plan_services_plan_id', ['planId'])
@Index('IDX_plan_services_medical_service_id', ['medicalServiceId'])
@Check('CHK_plan_services_limit_type', "\"limit_type\" IN ('UNLIMITED', 'MONTHLY', 'ANNUAL')")
@Check(
  'CHK_plan_services_limit_rule',
  '("limit_type" = \'UNLIMITED\' AND "limit_quantity" IS NULL) OR ("limit_type" IN (\'MONTHLY\', \'ANNUAL\') AND "limit_quantity" IS NOT NULL AND "limit_quantity" >= 1)',
)
@Check('CHK_plan_services_waiting_period', '"waiting_period_days" >= 0')
@Check('CHK_plan_services_copay_amount', '"copay_amount" >= 0')
@Check(
  'CHK_plan_services_copay_percentage',
  '"copay_percentage" >= 0 AND "copay_percentage" <= 100',
)
export class PlanService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  @ManyToOne('Plan', (p: Plan) => p.planServices, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ type: 'uuid', name: 'medical_service_id' })
  medicalServiceId: string;

  @ManyToOne('MedicalService', (ms: MedicalService) => ms.planServices, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'medical_service_id' })
  medicalService: MedicalService;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'limit_type',
    default: PlanServiceLimitType.UNLIMITED,
  })
  limitType: PlanServiceLimitType;

  @Column({ type: 'int', nullable: true, name: 'limit_quantity' })
  limitQuantity: number | null;

  @Column({ type: 'int', default: 0, name: 'waiting_period_days' })
  waitingPeriodDays: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    name: 'copay_amount',
  })
  copayAmount: number;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
    name: 'copay_percentage',
  })
  copayPercentage: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date | null;
}
