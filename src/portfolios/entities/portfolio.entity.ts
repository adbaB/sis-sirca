import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Contract } from '../../contracts/entities/contract.entity';
import { Exclude } from 'class-transformer';

export enum PortfolioStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('portfolios')
@Check(`"commission_amount" >= 0`)
export class Portfolio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  code: string;

  @Column({
    type: 'enum',
    enum: PortfolioStatus,
    default: PortfolioStatus.ACTIVE,
  })
  status: PortfolioStatus;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'commission_amount',
  })
  commissionAmount: number;

  @OneToMany(() => Contract, (contract: Contract) => contract.portfolio)
  contracts: Contract[];

  @Exclude()
  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @Exclude()
  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @Exclude()
  @DeleteDateColumn({ type: 'timestamp', name: 'deleted_at' })
  deletedAt: Date;
}
