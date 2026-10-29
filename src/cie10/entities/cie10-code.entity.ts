import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('cie10_codes')
export class Cie10Code {
  @PrimaryColumn({ type: 'varchar', length: 15 })
  code: string;

  @Index('IDX_cie10_codes_clean_code')
  @Column({ type: 'varchar', length: 15, name: 'clean_code', nullable: true })
  cleanCode: string | null;

  @Index('IDX_cie10_codes_description')
  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  chapter: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  block: string | null;

  @Index('IDX_cie10_codes_category')
  @Column({ type: 'varchar', length: 15, nullable: true })
  category: string | null;

  @Column({ type: 'varchar', length: 20, default: 'subcategory' })
  level: string;

  @Index('IDX_cie10_codes_is_terminal')
  @Column({ type: 'boolean', default: true, name: 'is_terminal' })
  isTerminal: boolean;

  @Column({ type: 'jsonb', nullable: true, default: () => "'{}'" })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
