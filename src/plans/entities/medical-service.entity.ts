import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { HealthCategory } from '../../contracts/entities/health-declaration.entity';
import type { ServiceCategory } from './service-category.entity';
import type { PlanService } from './plan-service.entity';

@Entity('medical_services')
@Index('UQ_medical_services_code_active', ['code'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('IDX_medical_services_category_id', ['categoryId'])
export class MedicalService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'uuid', name: 'category_id' })
  categoryId: string;

  @ManyToOne('ServiceCategory', (cat: ServiceCategory) => cat.medicalServices, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'category_id' })
  category: ServiceCategory;

  @Column({
    type: 'text',
    array: true,
    default: '{}',
    name: 'linked_health_categories',
  })
  linkedHealthCategories: HealthCategory[];

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @OneToMany('PlanService', (ps: PlanService) => ps.medicalService)
  planServices?: PlanService[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date | null;
}
