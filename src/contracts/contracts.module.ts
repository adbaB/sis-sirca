import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from '../aws/aws.module';
import { InvoiceModule } from '../billing/invoices/invoice.module';
import { PdfModule } from '../pdf/pdf.module';
import { PersonsModule } from '../persons/persons.module';
import { PlansModule } from '../plans/plans.module';
import { ContractsController } from './controllers/contracts.controller';
import { AffiliationHistory } from './entities/affiliation-history.entity';
import { ContractPerson } from './entities/contract-person.entity';
import { Contract } from './entities/contract.entity';
import { HealthDeclaration } from './entities/health-declaration.entity';
import { ContractQueryRepository } from './repositories/contract-query.repository';
import { ContractAffiliationService } from './services/contract-affiliation.service';
import { ContractCreationService } from './services/contract-creation.service';
import { ContractLifecycleService } from './services/contract-lifecycle.service';
import { ContractPdfService } from './services/contract-pdf.service';
import { ContractStatisticsService } from './services/contract-statistics.service';
import { ContractsService } from './services/contracts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contract, ContractPerson, AffiliationHistory, HealthDeclaration]),
    PersonsModule,
    InvoiceModule,
    PlansModule,
    AwsModule,
    PdfModule,
  ],
  controllers: [ContractsController],
  providers: [
    ContractQueryRepository,
    ContractAffiliationService,
    ContractLifecycleService,
    ContractPdfService,
    ContractStatisticsService,
    ContractCreationService,
    ContractsService,
  ],
  exports: [ContractsService, TypeOrmModule],
})
export class ContractsModule {}
