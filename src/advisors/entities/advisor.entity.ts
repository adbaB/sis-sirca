import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Generated,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Contract } from '../../contracts/entities/contract.entity';
import { Exclude, Expose } from 'class-transformer';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

@Entity('advisors')
export class Advisor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'boolean', default: true })
  status: boolean;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0.0,
    name: 'commission',
    transformer: decimalTransformer,
  })
  commission: number;

  @Column({ type: 'integer', name: 'code', unique: true })
  @Generated('increment')
  @Exclude()
  codeNumber: number;

  @Expose({ name: 'code' })
  get code(): string {
    if (!this.codeNumber) return '';
    return this.codeNumber < 1000
      ? String(this.codeNumber).padStart(3, '0')
      : String(this.codeNumber);
  }

  @OneToMany('Contract', (contract: Contract) => contract.advisor)
  contracts: Contract[];

  @Exclude()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Exclude()
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @Exclude()
  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date;
}
