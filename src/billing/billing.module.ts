import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceDetail } from './entities/invoice-detail.entity';
import { Payment } from './entities/payment.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { BillingService } from './services/billing.service';
import { BillingCronService } from './services/billing-cron.service';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, InvoiceDetail, Payment, Contract])],
  controllers: [],
  providers: [BillingService, BillingCronService],
})
export class BillingModule {}
