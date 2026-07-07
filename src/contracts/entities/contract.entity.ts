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
} from 'typeorm';
import type { Advisor } from '../../advisors/entities/advisor.entity';
import type { Surplus } from '../../billing/entities/surplus.entity';
import type { Invoice } from '../../billing/invoices/entities/invoice.entity';
import type { Portfolio } from '../../portfolios/entities/portfolio.entity';
import type { ContractPerson } from './contract-person.entity';

export enum ContractStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

const decimalTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

@Entity('contracts')
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0.0,
    name: 'retention_percentage',
    transformer: decimalTransformer,
  })
  retentionPercentage: number;

  @Column({ type: 'date', name: 'affiliation_date' })
  affiliationDate: Date;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    name: 'monthly_amount',
  })
  monthlyAmount: number;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: false })
  code: string;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true, name: 'legacy_code' })
  legacyCode?: string | null;

  @OneToMany('ContractPerson', (contractPerson: ContractPerson) => contractPerson.contract)
  contractPersons: ContractPerson[];

  @OneToMany('Invoice', (invoice: Invoice) => invoice.contract)
  invoices?: Invoice[] | null;

  @OneToMany('Surplus', (surplus: Surplus) => surplus.contract)
  surpluses?: Surplus[] | null;

  @ManyToOne('Advisor', (advisor: Advisor) => advisor.contracts, { nullable: true })
  @JoinColumn({ name: 'advisor_id' })
  advisor?: Advisor | null;

  @ManyToOne('Portfolio', (portfolio: Portfolio) => portfolio.contracts, { nullable: true })
  @JoinColumn({ name: 'portfolio_id', foreignKeyConstraintName: 'FK_contracts_portfolio' })
  portfolio?: Portfolio | null;

  @Column({ type: 'enum', enum: ContractStatus, default: ContractStatus.ACTIVE })
  status: ContractStatus;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'inactivation_reason' })
  inactivationReason: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
