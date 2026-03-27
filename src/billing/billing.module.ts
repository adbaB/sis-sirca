import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceDetail } from './entities/invoice-detail.entity';
import { Payment } from './entities/payment.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { BillingService } from './services/billing.service';
import { BillingCronService } from './services/billing-cron.service';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { GoogleModule } from '../google/google.module';
import { PaymentEventListener } from './listeners/payment-event.listener';
import { PaymentCronService } from './services/payment-cron.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceDetail, Payment, Contract]),
    ExchangeRateModule,
    GoogleModule,
  ],
  controllers: [],
  providers: [BillingService, BillingCronService, PaymentEventListener, PaymentCronService],
  exports: [BillingService],
})
export class BillingModule {}
