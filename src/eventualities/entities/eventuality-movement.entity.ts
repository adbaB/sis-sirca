import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Eventuality } from './eventuality.entity';
import type { ContractCoveragePeriod } from '../../contracts/entities/contract-coverage-period.entity';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

export enum MovementCategory {
  MEDICAMENTO = 'MEDICAMENTO',
  MATERIAL = 'MATERIAL',
  SERVICIO = 'SERVICIO',
  HONORARIOS = 'HONORARIOS',
  FACTURA_GLOBAL = 'FACTURA_GLOBAL',
  OTRO = 'OTRO',
}

@Entity('eventuality_movements')
@Index('IDX_em_eventuality_id', ['eventuality'])
@Index('IDX_em_coverage_period_id', ['coveragePeriod'])
@Check(
  'CHK_em_category',
  `"category" IN ('MEDICAMENTO', 'MATERIAL', 'SERVICIO', 'HONORARIOS', 'FACTURA_GLOBAL', 'OTRO')`,
)
@Check('CHK_em_cost_amount', '"cost_amount" >= 0')
@Check('CHK_em_coverage_amount', '"coverage_deducted_amount" >= 0')
export class EventualityMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Eventuality', (evt: Eventuality) => evt.movements, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'eventuality_id', foreignKeyConstraintName: 'FK_em_eventuality' })
  eventuality: Eventuality;

  @Column({ type: 'uuid', name: 'eventuality_id' })
  eventualityId: string;

  @ManyToOne('ContractCoveragePeriod', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'coverage_period_id',
    foreignKeyConstraintName: 'FK_em_coverage_period',
  })
  coveragePeriod: ContractCoveragePeriod;

  @Column({ type: 'uuid', name: 'coverage_period_id' })
  coveragePeriodId: string;

  @Column({ type: 'varchar', length: 30 })
  category: MovementCategory;

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'cost_amount',
    transformer: decimalTransformer,
  })
  costAmount: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'coverage_deducted_amount',
    transformer: decimalTransformer,
  })
  coverageDeductedAmount: number;

  @Column({ type: 'boolean', default: false, name: 'consumes_limit' })
  consumesLimit: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
