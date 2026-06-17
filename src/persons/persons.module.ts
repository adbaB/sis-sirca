import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsModule } from '../contracts/contracts.module';
import { PlansModule } from '../plans/plans.module';
import { PersonsController } from './controllers/persons.controller';
import { Person } from './entities/person.entity';
import { PersonsService } from './services/persons.service';
import { AffiliationHistory } from '../contracts/entities/affiliation-history.entity';
import { ContractPerson } from '../contracts/entities/contract-person.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { InvoiceLine } from '../billing/entities/invoice-line.entity';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Person, ContractPerson, AffiliationHistory, Invoice, InvoiceLine]),
    forwardRef(() => ContractsModule),
    forwardRef(() => BillingModule),
    PlansModule,
  ],
  controllers: [PersonsController],
  providers: [PersonsService],
  exports: [PersonsService],
})
export class PersonsModule {}
