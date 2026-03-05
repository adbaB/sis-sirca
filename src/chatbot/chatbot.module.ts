import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { AwsModule } from '../aws/aws.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [AwsModule, EmailModule],
  controllers: [ChatbotController],
  providers: [ChatbotService],
})
export class ChatbotModule {}
