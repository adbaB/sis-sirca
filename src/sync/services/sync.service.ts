import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigType } from '@nestjs/config';
import * as xlsx from 'xlsx';

import config from '../../config/configurations';
import { GoogleDriveService } from '../../google-drive/services/google-drive.service';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly googleDriveService: GoogleDriveService,
    @Inject(config.KEY)
    private configService: ConfigType<typeof config>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlySync() {
    this.logger.log('Starting hourly Excel sync...');

    const fileId = this.configService.drive.excelFileId;
    if (!fileId) {
      this.logger.warn('GOOGLE_DRIVE_EXCEL_FILE_ID is not configured. Aborting sync.');
      return;
    }

    const buffer = await this.googleDriveService.downloadExcelFile(fileId);
    if (!buffer) {
      this.logger.error('Failed to retrieve file buffer from Google Drive.');
      return;
    }

    try {
      // Parse the buffer using xlsx
      this.logger.log('Parsing Excel buffer...');
      const workbook = xlsx.read(buffer, { type: 'buffer' });

      const sheetName = workbook.SheetNames[0]; // Assuming data is on the first sheet
      const worksheet = workbook.Sheets[sheetName];

      const jsonData = xlsx.utils.sheet_to_json(worksheet);

      this.logger.log(`Successfully parsed ${jsonData.length} rows from Excel.`);

      // TODO: Add business logic here to process `jsonData`.
      // Example: this.logger.log(JSON.stringify(jsonData[0]));
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Error parsing Excel file: ${error.message}`, error.stack);
      } else {
        this.logger.error('Error parsing Excel file: Unknown error', String(error));
      }
    }
  }
}
