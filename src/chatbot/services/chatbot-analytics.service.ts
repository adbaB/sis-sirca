import { Injectable } from '@nestjs/common';
import { ChatbotInteraction, InteractionStatus } from '../entities/chatbot-interaction.entity';
import { UserState } from '../interfaces/userState.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Invoice } from '../../billing/invoices/entities/invoice.entity';

@Injectable()
export class ChatbotAnalyticsService {
  constructor(
    @InjectRepository(ChatbotInteraction)
    private readonly interactionRepo: Repository<ChatbotInteraction>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
  ) {}

  async trackStep(phone: string, step: string, metadata?: UserState): Promise<void> {
    let interaction = await this.interactionRepo.findOne({
      where: { phone, status: InteractionStatus.IN_PROGRESS },
    });

    if (!interaction) {
      interaction = this.interactionRepo.create({ phone, current_step: step });
    } else {
      interaction.current_step = step;
    }

    const selectedInvoiceIds = metadata?.selected_invoices;
    if (selectedInvoiceIds && Array.isArray(selectedInvoiceIds) && selectedInvoiceIds.length > 0) {
      // Buscamos las facturas reales en la BD por sus IDs
      const invoices = await this.invoiceRepo.find({
        where: { id: In(selectedInvoiceIds) },
      });
      interaction.invoices = invoices;
    }

    await this.interactionRepo.save(interaction);
  }

  async trackCompletion(phone: string): Promise<void> {
    await this.interactionRepo.update(
      { phone, status: InteractionStatus.IN_PROGRESS },
      {
        status: InteractionStatus.COMPLETED,
        current_step: 'COMPLETED',
        completed_at: new Date(),
      },
    );
  }

  // Para tu dashboard administrativo
  async getStuckUsers(): Promise<ChatbotInteraction[]> {
    return this.interactionRepo.find({
      where: { status: InteractionStatus.IN_PROGRESS },
      order: { updated_at: 'DESC' },
    });
  }

  async getCompletedUsers(): Promise<ChatbotInteraction[]> {
    return this.interactionRepo.find({
      where: { status: InteractionStatus.COMPLETED },
      order: { completed_at: 'DESC' },
      take: 50,
    });
  }
}
