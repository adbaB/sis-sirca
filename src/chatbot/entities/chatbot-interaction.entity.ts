import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Invoice } from '../../billing/invoices/entities/invoice.entity';
import { UserState } from '../interfaces/userState.interface';

export enum InteractionStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED', // Se puede marcar con un Cron Job después
}

@Entity('chatbot_interactions')
export class ChatbotInteraction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  phone: string;

  @Column({ type: 'enum', enum: InteractionStatus, default: InteractionStatus.IN_PROGRESS })
  status: InteractionStatus;

  @Column({ nullable: true })
  current_step: string;

  @Column({ type: 'json', nullable: true })
  metadata: UserState; // Ej: { selected_invoices: [...], payment_method: 'zelle' }

  // 🎯 NUEVA RELACIÓN: Una interacción puede tener múltiples facturas
  @ManyToMany(() => Invoice, { eager: true, cascade: true }) // eager para que salga en los gets sin hacer join manual
  @JoinTable({
    name: 'chatbot_interaction_invoices', // Nombre de la tabla intermedia
    joinColumn: { name: 'interaction_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'invoice_id', referencedColumnName: 'id' },
  })
  invoices: Invoice[];

  @CreateDateColumn()
  started_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  completed_at: Date;
}
