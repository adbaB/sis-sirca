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
import { SurplusService } from './services/surplus.service';
import { SurplusCronService } from './services/surplus-cron.service';
import { SurplusEventListener } from './listeners/surplus-event.listener';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceDetail, Payment, Contract, Surplus]),
    ExchangeRateModule,
    GoogleModule,
  ],
  controllers: [],
  providers: [
    BillingService,
    BillingCronService,
    PaymentEventListener,
    PaymentCronService,
    SurplusService,
    SurplusCronService,
    SurplusEventListener,
  ],
  exports: [BillingService, SurplusService],
})
export class BillingModule {}
