import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AwsModule } from './aws/aws.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { EnvConfigModule } from './config/env-config.module';
import { EmailModule } from './email/email.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [EnvConfigModule, AwsModule, EmailModule, PaymentsModule, ChatbotModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
