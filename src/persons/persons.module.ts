import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsModule } from '../contracts/contracts.module';
import { PlansModule } from '../plans/plans.module';
import { PersonsController } from './controllers/persons.controller';
import { Person } from './entities/person.entity';
import { PersonsService } from './services/persons.service';

@Module({
  imports: [TypeOrmModule.forFeature([Person]), forwardRef(() => ContractsModule), PlansModule],
  controllers: [PersonsController],
  providers: [PersonsService],
  exports: [PersonsService],
})
export class PersonsModule {}
