import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from '../contracts/entities/contract.entity';
import { EmailModule } from '../email/email.module';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { GoogleModule } from '../google/google.module';
import { PdfModule } from '../pdf/pdf.module';
import { InvoiceDetail } from './entities/invoice-detail.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Surplus } from './entities/surplus.entity';
import { BillingCronService } from './services/billing-cron.service';
import { BillingService } from './services/billing.service';
import { PaymentCronService } from './services/payment-cron.service';
import { PaymentPdfCronService } from './services/payment-pdf-cron.service';
import { SurplusCronService } from './services/surplus-cron.service';
import { SurplusService } from './services/surplus.service';

import { AwsModule } from '../aws/aws.module';
import { BillingController } from './billing.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceDetail, InvoiceLine, Payment, Contract, Surplus]),
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
    PaymentCronService,
    PaymentPdfCronService,
    SurplusService,
    SurplusCronService,
  ],
  exports: [BillingService, SurplusService],
})
export class BillingModule {}
