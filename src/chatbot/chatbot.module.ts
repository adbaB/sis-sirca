import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { AwsModule } from '../aws/aws.module';
import { EmailModule } from '../email/email.module';
import { OcrModule } from '../ocr/ocr.module';
import { BillingModule } from '../billing/billing.module';
import { PersonsModule } from '../persons/persons.module';

@Module({
  imports: [AwsModule, EmailModule, OcrModule, BillingModule, PersonsModule],
  controllers: [ChatbotController],
  providers: [ChatbotService],
})
export class ChatbotModule {}
