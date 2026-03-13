import { Module } from '@nestjs/common';
import { SyncService } from './services/sync.service';
import { GoogleDriveModule } from '../google-drive/google-drive.module';

@Module({
  imports: [GoogleDriveModule],
  providers: [SyncService],
})
export class SyncModule {}
