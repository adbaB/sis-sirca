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

const flowHandlersProvider = {
  provide: 'FLOW_HANDLERS',
  useFactory: (...handlers: FlowActionHandler[]) => handlers,
  inject: [FetchInvoiceHandler, FetchPaymentDetailHandler],
};

@Module({
  imports: [AwsModule, EmailModule, OcrModule, BillingModule, PersonsModule],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    MetaWhatsappService,
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
