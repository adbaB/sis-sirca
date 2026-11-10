import { forwardRef, Module } from '@nestjs/common';
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
import { EventualityTreatmentItem } from './entities/eventuality-treatment-item.entity';
import { EventualityServiceRequest } from './entities/eventuality-service-request.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import { MedicalService } from '../plans/entities/medical-service.entity';
import { DoctorsModule } from '../doctors/doctors.module';
import { Cie10Module } from '../cie10/cie10.module';
import { EventualitiesController } from './controllers/eventualities.controller';
import { EventualityHospitalizationController } from './controllers/eventuality-hospitalization.controller';
import { EventualityConsultationController } from './controllers/eventuality-consultation.controller';
import { EventualitiesService } from './services/eventualities.service';
import { EventualityHospitalizationService } from './services/eventuality-hospitalization.service';
import { EventualityConsultationService } from './services/eventuality-consultation.service';
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
      EventualityTreatmentItem,
      EventualityServiceRequest,
      Doctor,
      MedicalService,
      Person,
      ContractPerson,
    ]),
    ContractsModule,
    SystemSettingsModule,
    AwsModule,
    forwardRef(() => ChatbotModule),
    PdfModule,
    ExchangeRateModule,
    DoctorsModule,
    Cie10Module,
  ],
  controllers: [
    EventualitiesController,
    EventualityHospitalizationController,
    EventualityConsultationController,
  ],
  providers: [
    EventualitiesService,
    EventualityHospitalizationService,
    EventualityConsultationService,
    EventualityOcrService,
    EventualityPdfService,
    EventualityStatisticsService,
  ],
  exports: [
    EventualitiesService,
    EventualityHospitalizationService,
    EventualityConsultationService,
    EventualityOcrService,
    EventualityPdfService,
    EventualityStatisticsService,
    TypeOrmModule,
  ],
})
export class EventualitiesModule {}
