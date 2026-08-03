import { forwardRef, Module } from '@nestjs/common';
import { SurplusService } from './services/surplus.service';
import { PaymentService } from './services/payment.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { Surplus } from './entities/surplus.entity';
import { PaymentBillingController } from './controllers/payments-billing.controller';
import { AwsModule } from '../../aws/aws.module';
import { OcrModule } from '../../ocr/ocr.module';
import { ExchangeRateModule } from '../../exchange-rate/exchange-rate.module';
import { InvoiceModule } from '../invoices/invoice.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Surplus]),
    AwsModule,
    OcrModule,
    ExchangeRateModule,
    forwardRef(() => InvoiceModule),
  ],
  controllers: [PaymentBillingController],
  providers: [SurplusService, PaymentService],
  exports: [SurplusService, PaymentService],
})
export class PaymentModule {}
