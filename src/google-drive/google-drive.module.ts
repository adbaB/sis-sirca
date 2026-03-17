import { Module } from '@nestjs/common';
import { GoogleDriveService } from './services/google-drive.service';

@Module({
  providers: [GoogleDriveService],
  exports: [GoogleDriveService],
})
export class GoogleDriveModule {}
