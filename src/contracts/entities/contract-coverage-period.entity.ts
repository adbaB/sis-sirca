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
import type { Contract } from './contract.entity';
import type { ContractPerson } from './contract-person.entity';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

export enum CoveragePeriodStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

@Entity('contract_coverage_periods')
@Check('CHK_ccp_status', "\"status\" IN ('ACTIVE', 'CLOSED')")
@Check('CHK_ccp_initial_coverage', '"initial_coverage" >= 0')
@Check('CHK_ccp_consumed_coverage', '"consumed_coverage" >= 0')
@Check('CHK_ccp_reserved_coverage', '"reserved_coverage" >= 0')
@Check('CHK_ccp_remaining_coverage', '"remaining_coverage" >= 0')
@Check('CHK_ccp_dates', '"expiration_date" >= "start_date"')
@Index('IDX_ccp_contract_id', ['contract'])
@Index('IDX_ccp_contract_person_id', ['contractPerson'])
@Index('IDX_ccp_status_dates', ['status', 'startDate', 'expirationDate'])
@Index('UQ_ccp_active_person_period', ['contractPerson'], {
  unique: true,
  where: `"status" = 'ACTIVE' AND "deleted_at" IS NULL`,
})
export class ContractCoveragePeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Contract', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id', foreignKeyConstraintName: 'FK_ccp_contract' })
  contract: Contract;

  @Column({ type: 'uuid', name: 'contract_id' })
  contractId: string;

  @ManyToOne('ContractPerson', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'contract_person_id',
    foreignKeyConstraintName: 'FK_ccp_contract_person',
  })
  contractPerson: ContractPerson;

  @Column({ type: 'uuid', name: 'contract_person_id' })
  contractPersonId: string;

  @Column({ type: 'int', default: 1, name: 'period_number' })
  periodNumber: number;

  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'expiration_date' })
  expirationDate: Date;

  @Column({
    type: 'varchar',
    length: 20,
    default: CoveragePeriodStatus.ACTIVE,
  })
  status: CoveragePeriodStatus;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'initial_coverage',
    transformer: decimalTransformer,
  })
  initialCoverage: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'consumed_coverage',
    transformer: decimalTransformer,
  })
  consumedCoverage: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'reserved_coverage',
    transformer: decimalTransformer,
  })
  reservedCoverage: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'remaining_coverage',
    transformer: decimalTransformer,
  })
  remainingCoverage: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt?: Date | null;
}
