import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { InvoiceController } from './controllers/invoice.controller';
import { InvoiceBillingController } from './controllers/invoice-billing.controller';
import { InvoiceService } from './services/invoice.service';
import { PaymentModule } from '../payments/payment.module';
import { ExchangeRateModule } from '../../exchange-rate/exchange-rate.module';
import { PdfModule } from '../../pdf/pdf.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceLine]),
    forwardRef(() => PaymentModule),
    ExchangeRateModule,
    PdfModule,
  ],
  controllers: [InvoiceController, InvoiceBillingController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
