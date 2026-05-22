import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceDetail } from './entities/invoice-detail.entity';
import { Payment } from './entities/payment.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { Surplus } from './entities/surplus.entity';
import { BillingService } from './services/billing.service';
import { BillingCronService } from './services/billing-cron.service';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { GoogleModule } from '../google/google.module';
import { PaymentEventListener } from './listeners/payment-event.listener';
import { PaymentCronService } from './services/payment-cron.service';
import { PaymentPdfCronService } from './services/payment-pdf-cron.service';
import { SurplusService } from './services/surplus.service';
import { SurplusCronService } from './services/surplus-cron.service';
import { SurplusEventListener } from './listeners/surplus-event.listener';
import { EmailModule } from '../email/email.module';
import { PdfModule } from '../pdf/pdf.module';

import { BillingController } from './billing.controller';
import { AwsModule } from '../aws/aws.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceDetail, Payment, Contract, Surplus]),
    ExchangeRateModule,
    GoogleModule,
    EmailModule,
    PdfModule,
    AwsModule,
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingCronService,
    PaymentEventListener,
    PaymentCronService,
    PaymentPdfCronService,
    SurplusService,
    SurplusCronService,
    SurplusEventListener,
  ],
  exports: [BillingService, SurplusService],
})
export class BillingModule {}
