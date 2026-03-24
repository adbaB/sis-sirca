import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsService } from './services/contracts.service';
import { Contract } from './entities/contract.entity';
import { ContractPerson } from './entities/contract-person.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Contract, ContractPerson])],
  controllers: [],
  providers: [ContractsService],
  exports: [ContractsService, TypeOrmModule],
})
export class ContractsModule {}
