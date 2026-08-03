import { Module } from '@nestjs/common';
import { PaymentPdfCron } from './crons/payment-pdf.cron';
import { InvoiceModule } from './invoices/invoice.module';
import { PaymentModule } from './payments/payment.module';
import { ContractInactivationCron } from './crons/contract-inactivation.cron';
import { GenerateMonthlyInvoices } from './crons/generate-monthly-invoices.cron';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from '../contracts/entities/contract.entity';
import { EmailModule } from '../email/email.module';
import { PdfModule } from '../pdf/pdf.module';
import { AwsModule } from '../aws/aws.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contract]),
    InvoiceModule,
    PaymentModule,
    EmailModule,
    AwsModule,
    PdfModule,
  ],
  providers: [ContractInactivationCron, PaymentPdfCron, GenerateMonthlyInvoices],
  exports: [],
})
export class BillingModule {}
