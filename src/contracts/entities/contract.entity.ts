import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ContractPerson } from './contract-person.entity';
import type { Invoice } from '../../billing/entities/invoice.entity';
import type { Advisor } from '../../advisors/entities/advisor.entity';
import type { Surplus } from '../../billing/entities/surplus.entity';
import type { Portfolio } from '../../portfolios/entities/portfolio.entity';

export enum ContractStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('contracts')
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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
  @JoinColumn({ name: 'portfolio_id' })
  portfolio?: Portfolio | null;

  @Column({ type: 'enum', enum: ContractStatus, default: ContractStatus.ACTIVE })
  status: ContractStatus;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
