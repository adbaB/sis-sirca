import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { InvoiceLine } from '../billing/invoices/entities/invoice-line.entity';
import { Invoice } from '../billing/invoices/entities/invoice.entity';
import { ContractsModule } from '../contracts/contracts.module';
import { AffiliationHistory } from '../contracts/entities/affiliation-history.entity';
import { ContractPerson } from '../contracts/entities/contract-person.entity';
import { PlansModule } from '../plans/plans.module';
import { PersonsController } from './controllers/persons.controller';
import { Person } from './entities/person.entity';
import { PersonsService } from './services/persons.service';

import { HealthDeclaration } from '../contracts/entities/health-declaration.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Person,
      ContractPerson,
      AffiliationHistory,
      Invoice,
      InvoiceLine,
      HealthDeclaration,
    ]),
    forwardRef(() => ContractsModule),
    forwardRef(() => BillingModule),
    PlansModule,
  ],
  controllers: [PersonsController],
  providers: [PersonsService],
  exports: [PersonsService],
})
export class PersonsModule {}
