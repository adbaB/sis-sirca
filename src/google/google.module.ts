import { Module } from '@nestjs/common';
import { GoogleDriveService } from './services/google-drive.service';
import { GoogleSheetsService } from './services/google-sheets.service';

@Module({
  providers: [GoogleDriveService, GoogleSheetsService],
  exports: [GoogleDriveService, GoogleSheetsService],
})
export class GoogleModule {}
