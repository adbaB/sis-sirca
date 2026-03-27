import { Module } from '@nestjs/common';
import { GoogleSheetsService } from './services/google-sheets.service';

@Module({
  providers: [GoogleSheetsService],
  exports: [GoogleSheetsService],
})
export class GoogleSheetsModule {}
