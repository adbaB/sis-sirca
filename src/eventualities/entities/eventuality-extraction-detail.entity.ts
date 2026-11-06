import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Eventuality } from './eventuality.entity';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

export enum ConsumptionCategory {
  MEDICAMENTO = 'MEDICAMENTO',
  MATERIAL = 'MATERIAL',
  SERVICIO = 'SERVICIO',
}

export enum ExtractionStatus {
  EXTRACTED = 'EXTRACTED',
  EDITED = 'EDITED',
  ADDED = 'ADDED',
  REMOVED = 'REMOVED',
}

@Entity('eventuality_extraction_details')
@Index('IDX_eed_eventuality_id', ['eventuality'])
@Index('IDX_eed_category', ['category'])
@Check('CHK_eed_category', `"category" IN ('MEDICAMENTO', 'MATERIAL', 'SERVICIO')`)
@Check('CHK_eed_status', `"status" IN ('EXTRACTED', 'EDITED', 'ADDED', 'REMOVED')`)
@Check('CHK_eed_quantity', '"quantity" > 0')
@Check('CHK_eed_unit_cost', '"unit_cost" >= 0')
@Check('CHK_eed_total_cost', '"total_cost" >= 0')
@Check('CHK_eed_sale_price', '"calculated_sale_price" >= 0')
export class EventualityExtractionDetail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Eventuality', (evt: Eventuality) => evt.extractionDetails, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'eventuality_id', foreignKeyConstraintName: 'FK_eed_eventuality' })
  eventuality: Eventuality;

  @Column({ type: 'uuid', name: 'eventuality_id' })
  eventualityId: string;

  @Column({ type: 'varchar', length: 30 })
  category: ConsumptionCategory;

  @Column({ type: 'text', name: 'item_name' })
  itemName: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 3,
    default: 1.0,
    transformer: decimalTransformer,
  })
  quantity: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'unit_cost',
    transformer: decimalTransformer,
  })
  unitCost: number;

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
    precision: 12,
    scale: 2,
    name: 'unit_cost_bs',
    nullable: true,
    transformer: decimalTransformer,
  })
  unitCostBs?: number | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'total_cost_bs',
    nullable: true,
    transformer: decimalTransformer,
  })
  totalCostBs?: number | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
    name: 'calculated_sale_price',
    transformer: decimalTransformer,
  })
  calculatedSalePrice: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: ExtractionStatus.EXTRACTED,
  })
  status: ExtractionStatus;

  @Column({ type: 'text', name: 'raw_line_text', nullable: true })
  rawLineText?: string | null;

  @Index('IDX_eed_cutoff_date')
  @Column({ type: 'date', name: 'cutoff_date', nullable: true })
  cutoffDate?: string | Date | null;

  @Column({ type: 'text', name: 'source_file_url', nullable: true })
  sourceFileUrl?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
