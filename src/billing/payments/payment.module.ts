import { Module } from '@nestjs/common';
import { SurplusService } from './services/surplus.service';
import { PaymentService } from './services/payment.service';
import { PaymentCreationService } from './services/payment-creation.service';
import { PaymentStateService } from './services/payment-state.service';
import { PaymentUpdateService } from './services/payment-update.service';
import { PaymentQueryService } from './services/payment-query.service';
import { ReceiptAnalysisService } from './services/receipt-analysis.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { Surplus } from './entities/surplus.entity';
import { PaymentBillingController } from './controllers/payments-billing.controller';
import { AwsModule } from '../../aws/aws.module';
import { OcrModule } from '../../ocr/ocr.module';
import { ExchangeRateModule } from '../../exchange-rate/exchange-rate.module';
import { InvoiceModule } from '../invoices/invoice.module';

/**
 * Módulo NestJS encargado de gestionar toda la lógica de dominio de Pagos y Excedentes.
 *
 * Incluye controladores HTTP para la API administrativa, servicios especializados de creación,
 * consulta, cambio de estado, actualización y análisis OCR de comprobantes bancarios.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Surplus]),
    AwsModule,
    OcrModule,
    ExchangeRateModule,
    InvoiceModule,
  ],
  controllers: [PaymentBillingController],
  providers: [
    SurplusService,
    PaymentService,
    PaymentCreationService,
    PaymentStateService,
    PaymentUpdateService,
    PaymentQueryService,
    ReceiptAnalysisService,
  ],
  exports: [SurplusService, PaymentService, ReceiptAnalysisService],
})
export class PaymentModule {}
