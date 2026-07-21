import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ChatbotInteraction, InteractionStatus } from '../entities/chatbot-interaction.entity';
import { getCaracasNow } from '../../common/utils/date.util';

@Injectable()
export class AbandonedTasksService {
  private readonly logger = new Logger(AbandonedTasksService.name);

  constructor(
    @InjectRepository(ChatbotInteraction)
    private readonly interactionRepo: Repository<ChatbotInteraction>,
  ) {}

  // Se ejecuta cada hora
  @Cron(CronExpression.EVERY_HOUR)
  async handleAbandonedChats() {
    const twoHoursAgo = getCaracasNow().minus({ hours: 2 }).toJSDate();

    const result = await this.interactionRepo.update(
      {
        status: InteractionStatus.IN_PROGRESS,
        updated_at: LessThan(twoHoursAgo),
      },
      { status: InteractionStatus.ABANDONED },
    );

    if (result.affected > 0) {
      this.logger.log(`Marked ${result.affected} chats as ABANDONED.`);
    }
  }
}
