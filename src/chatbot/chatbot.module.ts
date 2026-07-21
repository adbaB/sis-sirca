import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './services/chatbot.service';
import { AwsModule } from '../aws/aws.module';
import { EmailModule } from '../email/email.module';
import { OcrModule } from '../ocr/ocr.module';
import { BillingModule } from '../billing/billing.module';
import { PersonsModule } from '../persons/persons.module';
import { MetaWhatsappService } from './services/meta-whatsapp.service';
import { ChatbotStateService } from './services/chatbot-state.service';
import { ChatbotPaymentService } from './services/chatbot-payment.service';

import { AwaitingCaptureStep } from './steps/stepsImp/AwaitingCapture.step';
import { AwaitingConfirmationStep } from './steps/stepsImp/AwaitingConfirmation.step';
import { AwaitingDocInfoManualStep } from './steps/stepsImp/AwaitingDocInfoManual.step';
import { AwaitingFlowInteractionStep } from './steps/stepsImp/AwaitingFlowInteraction.step';
import { AwaitingInvoiceSelectionManualStep } from './steps/stepsImp/AwaitingInvoiceSelectionManual.step';
import { AwaitingManualInputStep } from './steps/stepsImp/AwaitingManualInput.step';
import { AwaitingPaymentMethodManualStep } from './steps/stepsImp/AwaitingPaymentMethodManual.step';
import { IStepHandler } from './steps/step-handler.interface';
import { MetaFlowService } from './services/meta-flow.service';
import { FetchPaymentDetailHandler } from './steps/flowHandlersImp/fetchPaymentDetail.handler';
import { FetchInvoiceHandler } from './steps/flowHandlersImp/fetchInvoice.handler';
import { FlowActionHandler } from './steps/flow-handler.interface';
import { ChatbotAnalyticsService } from './services/chatbot-analytics.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatbotInteraction } from './entities/chatbot-interaction.entity';
import { Invoice } from '../billing/invoices/entities/invoice.entity';

const stepHandlersProvider = {
  provide: 'STEP_HANDLERS',
  useFactory: (...steps: IStepHandler[]) => steps,
  inject: [
    AwaitingCaptureStep,
    AwaitingConfirmationStep,
    AwaitingDocInfoManualStep,
    AwaitingFlowInteractionStep,
    AwaitingInvoiceSelectionManualStep,
    AwaitingManualInputStep,
    AwaitingPaymentMethodManualStep,
  ],
};

import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { ReminderService } from './services/reminder.service';

const flowHandlersProvider = {
  provide: 'FLOW_HANDLERS',
  useFactory: (...handlers: FlowActionHandler[]) => handlers,
  inject: [FetchInvoiceHandler, FetchPaymentDetailHandler],
};

@Module({
  imports: [
    AwsModule,
    EmailModule,
    OcrModule,
    BillingModule,
    PersonsModule,
    ExchangeRateModule,
    TypeOrmModule.forFeature([ChatbotInteraction, Invoice]),
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    MetaWhatsappService,
    ReminderService,
    ChatbotAnalyticsService,
    ChatbotStateService,
    ChatbotPaymentService,
    AwaitingCaptureStep,
    AwaitingConfirmationStep,
    AwaitingDocInfoManualStep,
    AwaitingFlowInteractionStep,
    AwaitingInvoiceSelectionManualStep,
    AwaitingManualInputStep,
    AwaitingPaymentMethodManualStep,
    stepHandlersProvider,
    MetaFlowService,
    FetchInvoiceHandler,
    FetchPaymentDetailHandler,
    flowHandlersProvider,
  ],
})
export class ChatbotModule {}
