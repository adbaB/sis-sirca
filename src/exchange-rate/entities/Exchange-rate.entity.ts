import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'exchange_rate' })
export class ExchangeRate {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ type: 'date', nullable: false, unique: true })
  date: Date;

  @Column({ type: 'decimal', nullable: false, precision: 10, scale: 2 })
  rateUsd: number;

  @Column({ type: 'decimal', nullable: false, precision: 10, scale: 2 })
  rateEur: number;

  @Exclude({ toPlainOnly: true })
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @Exclude({ toPlainOnly: true })
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
