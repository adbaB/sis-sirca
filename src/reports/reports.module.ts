import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../billing/payments/entities/payment.entity';
import { Invoice } from '../billing/invoices/entities/invoice.entity';
import { ContractPerson } from '../contracts/entities/contract-person.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { PdfModule } from '../pdf/pdf.module';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { AffiliationHistory } from '../contracts/entities/affiliation-history.entity';
import { AdvisorPaymentsService } from './advisor-payments.service';
import { AffiliationsReportService } from './affiliations-report.service';
import { ProjectionReportService } from './projection-report.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SipCommissionsService } from './sip-commissions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, Contract, ContractPerson, Payment, AffiliationHistory]),
    PdfModule,
    ExchangeRateModule,
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    SipCommissionsService,
    AdvisorPaymentsService,
    ProjectionReportService,
    AffiliationsReportService,
  ],
  exports: [
    ReportsService,
    SipCommissionsService,
    AdvisorPaymentsService,
    ProjectionReportService,
    AffiliationsReportService,
  ],
})
export class ReportsModule {}
