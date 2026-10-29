import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Eventuality } from '../../eventualities/entities/eventuality.entity';

@Entity('doctors')
export class Doctor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, name: 'first_name' })
  firstName: string;

  @Column({ type: 'varchar', length: 100, name: 'last_name' })
  lastName: string;

  @Column({ type: 'varchar', length: 10, default: 'V', name: 'type_identity_card' })
  typeIdentityCard: string;

  @Index('IDX_doctors_identity_card', { unique: true })
  @Column({ type: 'varchar', length: 30, unique: true, name: 'identity_card' })
  identityCard: string;

  @Column({ type: 'date', nullable: true, name: 'graduation_date' })
  graduationDate: string | null;

  @Column({ type: 'varchar', length: 150 })
  specialty: string;

  @Column({ type: 'varchar', length: 50 })
  mpps: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  comezu: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true, name: 'digital_signature_url' })
  digitalSignatureUrl: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @OneToMany('Eventuality', 'doctor')
  eventualities?: Eventuality[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
