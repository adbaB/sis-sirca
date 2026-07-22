import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators';
import { ChatbotAnalyticsService } from './services/chatbot-analytics.service';
import { GetInteractionsQueryDto } from './dto/get-interactions-query.dto';

@Controller('chatbot-analytics')
export class ChatbotAnalyticsController {
  constructor(private readonly analyticsService: ChatbotAnalyticsService) {}

  @Get('interactions')
  @RequirePermissions('read:pipeline')
  async getInteractions(@Query() query: GetInteractionsQueryDto) {
    return this.analyticsService.getInteractionsByInvoice(query.invoiceId, query);
  }

  @Post('check-interactions')
  @RequirePermissions('read:pipeline')
  async checkInteractions(@Body('invoiceIds') invoiceIds: string[]) {
    return this.analyticsService.checkInvoicesWithInteractions(invoiceIds);
  }

  @Get('active-operations')
  @RequirePermissions('read:pipeline')
  async getActiveOperations() {
    return this.analyticsService.getActiveOperations();
  }
}
