import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AwsModule } from './aws/aws.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { EnvConfigModule } from './config/env-config.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { PaymentsModule } from './payments/payments.module';
import { PlansModule } from './plans/plans.module';
import { PersonsModule } from './persons/persons.module';
import { ContractsModule } from './contracts/contracts.module';

@Module({
  imports: [
    EnvConfigModule,
    DatabaseModule,
    AwsModule,
    EmailModule,
    PaymentsModule,
    ChatbotModule,
    PlansModule,
    PersonsModule,
    ContractsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
