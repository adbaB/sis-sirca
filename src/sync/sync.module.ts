import { Module } from '@nestjs/common';
import { AdvisorsModule } from '../advisors/advisors.module';
import { ContractsModule } from '../contracts/contracts.module';
import { GoogleModule } from '../google/google.module';
import { PersonsModule } from '../persons/persons.module';
import { PlansModule } from '../plans/plans.module';
import { SyncService } from './services/sync.service';

@Module({
  imports: [GoogleModule, PlansModule, ContractsModule, PersonsModule, AdvisorsModule],
  providers: [SyncService],
  exports: [],
})
export class SyncModule {}
