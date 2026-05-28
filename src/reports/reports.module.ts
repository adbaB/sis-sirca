import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../billing/entities/invoice.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { ContractPerson } from '../contracts/entities/contract-person.entity';
import { Payment } from '../billing/entities/payment.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Contract, ContractPerson, Payment]), PdfModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
