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
import { BillingModule } from './billing/billing.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SyncModule } from './sync/sync.module';
import { OcrModule } from './ocr/ocr.module';
import { ExchangeRateModule } from './exchange-rate/exchange-rate.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PaymentTypesModule } from './payment-types/payment-types.module';
import { GoogleModule } from './google/google.module';
import { RedisModule } from '@nestjs-modules/ioredis';
import config from './config/configurations';

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
    BillingModule,
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    SyncModule,
    OcrModule,
    ExchangeRateModule,
    PaymentTypesModule,
    GoogleModule,
    RedisModule.forRootAsync({
      inject: [config.KEY],
      useFactory: (configService: ReturnType<typeof config>) => ({
        type: 'single',
        url: `redis://${configService.redis.password ? `:${configService.redis.password}@` : ''}${configService.redis.host}:${configService.redis.port}`,
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
