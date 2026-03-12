import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsService } from './services/contracts.service';
import { Contract } from './entities/contract.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Contract])],
  controllers: [],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
