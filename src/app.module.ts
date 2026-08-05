import { RedisModule } from '@nestjs-modules/ioredis';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ContextInterceptor } from './common/interceptors/context.interceptor';
import { GlobalExceptionFilter, TypeOrmExceptionFilter } from './common/filters';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { AdvisorsModule } from './advisors/advisors.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AwsModule } from './aws/aws.module';
import { BillingModule } from './billing/billing.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import config from './config/configurations';
import { EnvConfigModule } from './config/env-config.module';
import { ContractsModule } from './contracts/contracts.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { ExchangeRateModule } from './exchange-rate/exchange-rate.module';
import { OcrModule } from './ocr/ocr.module';
import { PdfModule } from './pdf/pdf.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PersonsModule } from './persons/persons.module';
import { PlansModule } from './plans/plans.module';
import { ReportsModule } from './reports/reports.module';
import { RolesModule } from './roles/roles.module';
import { StatisticsModule } from './statistics/statistics.module';
import { UsersModule } from './users/users.module';
import { PortfoliosModule } from './portfolios/portfolios.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    EnvConfigModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    AwsModule,
    EmailModule,
    ChatbotModule,
    PlansModule,
    PersonsModule,
    ContractsModule,
    BillingModule,
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    OcrModule,
    ExchangeRateModule,
    PdfModule,
    RedisModule.forRootAsync({
      inject: [config.KEY],
      useFactory: (configService: ReturnType<typeof config>) => ({
        type: 'single',
        url: `redis://${configService.redis.password ? `:${configService.redis.password}@` : ''}${configService.redis.host}:${configService.redis.port}`,
      }),
    }),
    AdvisorsModule,
    StatisticsModule,
    ReportsModule,
    PortfoliosModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: TypeOrmExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ContextInterceptor,
    },
  ],
})
export class AppModule {}
