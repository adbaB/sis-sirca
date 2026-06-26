import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../billing/entities/payment.entity';
import { Invoice } from '../billing/invoices/entities/invoice.entity';
import { ContractPerson } from '../contracts/entities/contract-person.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { PdfModule } from '../pdf/pdf.module';
import { AdvisorPaymentsService } from './advisor-payments.service';
import { ProjectionReportService } from './projection-report.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SipCommissionsService } from './sip-commissions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Contract, ContractPerson, Payment]), PdfModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    SipCommissionsService,
    AdvisorPaymentsService,
    ProjectionReportService,
  ],
})
export class ReportsModule {}
