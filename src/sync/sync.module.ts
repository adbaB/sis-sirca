import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { GoogleDriveModule } from '../google-drive/google-drive.module';
import { PersonsModule } from '../persons/persons.module';
import { PlansModule } from '../plans/plans.module';
import { SyncService } from './services/sync.service';

@Module({
  imports: [GoogleDriveModule, PlansModule, ContractsModule, PersonsModule],
  providers: [SyncService],
  exports: [],
})
export class SyncModule {}
