import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from '../aws/aws.module';
import { ContractsModule } from '../contracts/contracts.module';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { Person } from '../persons/entities/person.entity';
import { ContractPerson } from '../contracts/entities/contract-person.entity';
import { Eventuality } from './entities/eventuality.entity';
import { EventualityExtractionDetail } from './entities/eventuality-extraction-detail.entity';
import { EventualityMedicalReport } from './entities/eventuality-medical-report.entity';
import { EventualityMovement } from './entities/eventuality-movement.entity';
import { EventualityProviderInvoice } from './entities/eventuality-provider-invoice.entity';
import { EventualitiesController } from './controllers/eventualities.controller';
import { EventualitiesService } from './services/eventualities.service';
import { EventualityOcrService } from './services/eventuality-ocr.service';
import { EventualityPdfService } from './services/eventuality-pdf.service';
import { EventualityStatisticsService } from './services/eventuality-statistics.service';
import { PdfModule } from '../pdf/pdf.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Eventuality,
      EventualityExtractionDetail,
      EventualityMedicalReport,
      EventualityMovement,
      EventualityProviderInvoice,
      Person,
      ContractPerson,
    ]),
    ContractsModule,
    SystemSettingsModule,
    AwsModule,
    ChatbotModule,
    PdfModule,
    ExchangeRateModule,
  ],
  controllers: [EventualitiesController],
  providers: [
    EventualitiesService,
    EventualityOcrService,
    EventualityPdfService,
    EventualityStatisticsService,
  ],
  exports: [
    EventualitiesService,
    EventualityOcrService,
    EventualityPdfService,
    EventualityStatisticsService,
    TypeOrmModule,
  ],
})
export class EventualitiesModule {}
