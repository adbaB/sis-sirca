import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsService } from './services/contracts.service';
import { Contract } from './entities/contract.entity';
import { ContractPerson } from './entities/contract-person.entity';
import { AffiliationHistory } from './entities/affiliation-history.entity';
import { ContractsController } from './controllers/contracts.controller';
import { PersonsModule } from '../persons/persons.module';
import { BillingModule } from '../billing/billing.module';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contract, ContractPerson, AffiliationHistory]),
    forwardRef(() => PersonsModule),
    forwardRef(() => BillingModule),
    PlansModule,
  ],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService, TypeOrmModule],
})
export class ContractsModule {}
