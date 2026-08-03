import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import type { Role } from '../../roles/entities/role.entity';
import type { Advisor } from '../../advisors/entities/advisor.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_users_email')
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Exclude()
  @Column({ type: 'varchar', length: 255 })
  password: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Index('IDX_users_role_id')
  @Column({ type: 'uuid', name: 'role_id', nullable: true })
  roleId: string;

  @ManyToOne('Role', (role: Role) => role.users, {
    eager: true,
    onUpdate: 'NO ACTION',
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'role_id', foreignKeyConstraintName: 'FK_users_role' })
  role: Role;

  @Index('IDX_users_advisor_id')
  @Column({ type: 'uuid', name: 'advisor_id', nullable: true })
  advisorId: string;

  @ManyToOne('Advisor', {
    nullable: true,
    eager: true,
    onUpdate: 'NO ACTION',
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'advisor_id', foreignKeyConstraintName: 'FK_users_advisor' })
  advisor: Advisor;

  @Exclude()
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Exclude()
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
