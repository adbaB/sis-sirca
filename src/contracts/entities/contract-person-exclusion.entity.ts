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
import type { ContractPerson } from './contract-person.entity';
import type { MedicalService } from '../../plans/entities/medical-service.entity';
import type { ServiceCategory } from '../../plans/entities/service-category.entity';
import { ExclusionSource } from './exclusion-source.enum';

@Entity('contract_person_exclusions')
@Check('CHK_cpe_target', '"medical_service_id" IS NOT NULL OR "service_category_id" IS NOT NULL')
@Index('IDX_cpe_contract_person_id', ['contractPerson'])
@Index('IDX_cpe_medical_service_id', ['medicalService'])
@Index('IDX_cpe_service_category_id', ['serviceCategory'])
@Index('IDX_cpe_source', ['source'])
@Index('UQ_cpe_person_medical_service_active', ['contractPerson', 'medicalService'], {
  unique: true,
  where: '"deleted_at" IS NULL AND "medical_service_id" IS NOT NULL',
})
@Index('UQ_cpe_person_service_category_active', ['contractPerson', 'serviceCategory'], {
  unique: true,
  where:
    '"deleted_at" IS NULL AND "medical_service_id" IS NULL AND "service_category_id" IS NOT NULL',
})
export class ContractPersonExclusion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('ContractPerson', (cp: ContractPerson) => cp.exclusions, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'contract_person_id' })
  contractPerson: ContractPerson;

  @Column({ type: 'uuid', name: 'contract_person_id' })
  contractPersonId: string;

  @ManyToOne('MedicalService', { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'medical_service_id' })
  medicalService?: MedicalService | null;

  @Column({ type: 'uuid', name: 'medical_service_id', nullable: true })
  medicalServiceId?: string | null;

  @ManyToOne('ServiceCategory', { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_category_id' })
  serviceCategory?: ServiceCategory | null;

  @Column({ type: 'uuid', name: 'service_category_id', nullable: true })
  serviceCategoryId?: string | null;

  @Column({ type: 'text' })
  reason: string;

  @Column({
    type: 'enum',
    enum: ExclusionSource,
    default: ExclusionSource.AUTOMATIC,
  })
  source: ExclusionSource;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date | null;
}
