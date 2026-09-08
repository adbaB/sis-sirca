import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractPersonExclusion } from '../contracts/entities/contract-person-exclusion.entity';
import { ContractPerson } from '../contracts/entities/contract-person.entity';
import { PlanService } from '../plans/entities/plan-service.entity';
import { PersonsController } from './controllers/persons.controller';
import { Person } from './entities/person.entity';
import { PersonBenefitsService } from './services/person-benefits.service';
import { PersonsService } from './services/persons.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Person, ContractPerson, PlanService, ContractPersonExclusion]),
  ],
  controllers: [PersonsController],
  providers: [PersonsService, PersonBenefitsService],
  exports: [PersonsService, PersonBenefitsService],
})
export class PersonsModule {}
