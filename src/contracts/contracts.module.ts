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
import { ContractPersonExclusion } from './entities/contract-person-exclusion.entity';
import { EmailModule } from '../email/email.module';
import { ContractSuspensionCron } from './crons/contract-suspension.cron';
import { ContractReactivationCron } from './crons/contract-reactivation.cron';
import { ContractInactivationCron } from './crons/contract-inactivation.cron';
import { ContractQueryRepository } from './repositories/contract-query.repository';
import { ContractAffiliationService } from './services/contract-affiliation.service';
import { ContractCreationService } from './services/contract-creation.service';
import { ContractLifecycleService } from './services/contract-lifecycle.service';
import { ContractPdfService } from './services/contract-pdf.service';
import { ContractReactivationService } from './services/contract-reactivation.service';
import { ContractStatisticsService } from './services/contract-statistics.service';
import { ContractVerificationService } from './services/contract-verification.service';
import { ContractsService } from './services/contracts.service';
import { HealthExclusionsService } from './services/health-exclusions.service';
import { ContractAttachmentService } from './services/contract-attachment.service';

import { ContractCoveragePeriod } from './entities/contract-coverage-period.entity';
import { CoveragePeriodService } from './services/coverage-period.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractPerson,
      AffiliationHistory,
      HealthDeclaration,
      ContractPersonExclusion,
      ContractCoveragePeriod,
    ]),
    PersonsModule,
    InvoiceModule,
    PlansModule,
    AwsModule,
    PdfModule,
    EmailModule,
  ],
  controllers: [ContractsController],
  providers: [
    ContractQueryRepository,
    ContractAffiliationService,
    ContractVerificationService,
    ContractLifecycleService,
    ContractReactivationService,
    ContractPdfService,
    ContractStatisticsService,
    ContractCreationService,
    ContractsService,
    ContractAttachmentService,
    HealthExclusionsService,
    ContractSuspensionCron,
    ContractReactivationCron,
    ContractInactivationCron,
    CoveragePeriodService,
  ],
  exports: [
    ContractsService,
    ContractAttachmentService,
    HealthExclusionsService,
    CoveragePeriodService,
    TypeOrmModule,
  ],
})
export class ContractsModule {}
