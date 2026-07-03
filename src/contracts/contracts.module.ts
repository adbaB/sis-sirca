import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsService } from './services/contracts.service';
import { Contract } from './entities/contract.entity';
import { ContractPerson } from './entities/contract-person.entity';
import { AffiliationHistory } from './entities/affiliation-history.entity';
import { HealthDeclaration } from './entities/health-declaration.entity';
import { ContractsController } from './controllers/contracts.controller';
import { PersonsModule } from '../persons/persons.module';
import { BillingModule } from '../billing/billing.module';
import { PlansModule } from '../plans/plans.module';
import { AwsModule } from '../aws/aws.module';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contract, ContractPerson, AffiliationHistory, HealthDeclaration]),
    forwardRef(() => PersonsModule),
    forwardRef(() => BillingModule),
    PlansModule,
    AwsModule,
    PdfModule,
  ],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService, TypeOrmModule],
})
export class ContractsModule {}
