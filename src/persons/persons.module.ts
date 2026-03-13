import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonsService } from './services/persons.service';
import { Person } from './entities/person.entity';
import { ContractsModule } from '../contracts/contracts.module';
import { PlansModule } from 'src/plans/plans.module';

@Module({
  imports: [TypeOrmModule.forFeature([Person]), ContractsModule, PlansModule],
  controllers: [],
  providers: [PersonsService],
  exports: [PersonsService],
})
export class PersonsModule {}
