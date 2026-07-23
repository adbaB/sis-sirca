import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from '../contracts/entities/contract.entity';
import { EmailModule } from '../email/email.module';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { GoogleModule } from '../google/google.module';
import { PdfModule } from '../pdf/pdf.module';
import { BillingCronService } from './crons/billing-cron.service';
import { ContractInactivationCronService } from './crons/contract-inactivation-cron.service';
import { PaymentCronService } from './crons/payment-cron.service';
import { PaymentPdfCronService } from './crons/payment-pdf-cron.service';
import { SurplusCronService } from './crons/surplus-cron.service';
import { Payment } from './entities/payment.entity';
import { Surplus } from './entities/surplus.entity';
import { InvoiceDetail } from './invoices/entities/invoice-detail.entity';
import { InvoiceLine } from './invoices/entities/invoice-line.entity';
import { Invoice } from './invoices/entities/invoice.entity';
import { BillingService } from './services/billing.service';
import { SurplusService } from './services/surplus.service';
import { InvoiceService } from './invoices/services/invoice.service';
import { PaymentService } from './payment/services/payment.service';

import { AwsModule } from '../aws/aws.module';
import { OcrModule } from '../ocr/ocr.module';
import { BillingController } from './controllers/billing.controller';
import { InvoiceController } from './invoices/controllers/invoice.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceDetail, InvoiceLine, Payment, Contract, Surplus]),
    ExchangeRateModule,
    GoogleModule,
    EmailModule,
    PdfModule,
    AwsModule,
    OcrModule,
  ],
  controllers: [BillingController, InvoiceController],
  providers: [
    BillingService,
    BillingCronService,
    ContractInactivationCronService,
    PaymentCronService,
    PaymentPdfCronService,
    SurplusService,
    SurplusCronService,
    InvoiceService,
    PaymentService,
  ],
  exports: [BillingService, SurplusService, InvoiceService, PaymentService],
})
export class BillingModule {}
