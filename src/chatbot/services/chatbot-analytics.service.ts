import { Injectable } from '@nestjs/common';
import { ChatbotInteraction, InteractionStatus } from '../entities/chatbot-interaction.entity';
import { UserState } from '../interfaces/userState.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Invoice } from '../../billing/invoices/entities/invoice.entity';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { paginateRepository } from '../../common/utils/pagination.util';

@Injectable()
export class ChatbotAnalyticsService {
  constructor(
    @InjectRepository(ChatbotInteraction)
    private readonly interactionRepo: Repository<ChatbotInteraction>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
  ) {}

  /** Strip leading '+' so '+584…' and '584…' resolve to the same record. */
  private normalizePhone(phone: string): string {
    return phone.startsWith('+') ? phone.slice(1) : phone;
  }

  async trackStep(phone: string, step: string, metadata?: UserState): Promise<void> {
    const normalized = this.normalizePhone(phone);
    let interaction = await this.interactionRepo.findOne({
      where: { phone: normalized, status: InteractionStatus.IN_PROGRESS },
    });

    if (!interaction) {
      interaction = this.interactionRepo.create({ phone: normalized, current_step: step });
    } else {
      interaction.current_step = step;
    }

    if (metadata) {
      interaction.metadata = metadata;
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
    const normalized = this.normalizePhone(phone);
    await this.interactionRepo.update(
      { phone: normalized, status: InteractionStatus.IN_PROGRESS },
      {
        status: InteractionStatus.COMPLETED,
        current_step: 'COMPLETED',
        completed_at: new Date(),
      },
    );
  }

  async getInteractionsByInvoice(
    invoiceId: string,
    paginationQuery: PaginationQueryDto,
  ): Promise<PaginatedResult<ChatbotInteraction>> {
    return paginateRepository(
      this.interactionRepo,
      {
        where: {
          invoices: {
            id: invoiceId,
          },
        },
        order: { updated_at: 'DESC' },
      },
      paginationQuery,
    );
  }

  async checkInvoicesWithInteractions(
    invoiceIds: string[],
  ): Promise<Record<string, { hasInteractions: boolean; hasActive: boolean }>> {
    if (!invoiceIds || invoiceIds.length === 0) {
      return {};
    }

    const interactions = await this.interactionRepo.find({
      where: {
        invoices: {
          id: In(invoiceIds),
        },
      },
      relations: ['invoices'],
    });

    const result: Record<string, { hasInteractions: boolean; hasActive: boolean }> = {};
    for (const id of invoiceIds) {
      result[id] = { hasInteractions: false, hasActive: false };
    }

    for (const interaction of interactions) {
      if (interaction.invoices) {
        for (const inv of interaction.invoices) {
          if (invoiceIds.includes(inv.id)) {
            result[inv.id].hasInteractions = true;
            if (interaction.status === InteractionStatus.IN_PROGRESS) {
              result[inv.id].hasActive = true;
            }
          }
        }
      }
    }

    return result;
  }

  async getActiveOperations() {
    const interactions = await this.interactionRepo
      .createQueryBuilder('interaction')
      .leftJoinAndSelect('interaction.invoices', 'invoice')
      .leftJoinAndSelect('invoice.contract', 'contract')
      .leftJoinAndSelect('contract.contractPersons', 'contractPerson')
      .leftJoinAndSelect('contractPerson.person', 'person')
      .where('interaction.status = :status', { status: InteractionStatus.IN_PROGRESS })
      .orderBy('interaction.updated_at', 'DESC')
      .getMany();

    return interactions.map((interaction) => {
      // Find the main active invoice for this interaction
      // (An interaction could have multiple, but usually one is processed primarily)
      const mainInvoice =
        interaction.invoices && interaction.invoices.length > 0 ? interaction.invoices[0] : null;

      let holderName = null;
      let invoiceCode = null;

      if (mainInvoice) {
        invoiceCode = mainInvoice.billingMonth
          ? `${mainInvoice.contract?.code} - ${mainInvoice.billingMonth}`
          : mainInvoice.contract?.code;

        if (mainInvoice.contract && mainInvoice.contract.contractPersons) {
          const titular = mainInvoice.contract.contractPersons.find((cp) => cp.role === 'TITULAR');
          const billingOwner = mainInvoice.contract.contractPersons.find((cp) => cp.isBillingOwner);

          if (titular && titular.person) {
            holderName = titular.person.name;
          } else if (billingOwner && billingOwner.person) {
            holderName = billingOwner.person.name;
          }
        }
      }

      return {
        id: interaction.id,
        phone: interaction.phone,
        step: interaction.current_step,
        started_at: interaction.started_at,
        invoiceCode: invoiceCode,
        holderName: holderName,
        invoiceId: mainInvoice?.id || null,
      };
    });
  }
}
