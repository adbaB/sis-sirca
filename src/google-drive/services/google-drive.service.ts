import { Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { google, drive_v3 } from 'googleapis';
import config from '../../config/configurations';
import { Inject } from '@nestjs/common';

@Injectable()
export class GoogleDriveService {
  private driveClient: drive_v3.Drive;
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(
    @Inject(config.KEY)
    private configService: ConfigType<typeof config>,
  ) {
    this.initClient();
  }

  private initClient() {
    const { clientEmail, privateKey } = this.configService.drive;

    if (!clientEmail || !privateKey) {
      this.logger.warn(
        'Google Drive credentials not fully configured. Service will not fetch files.',
      );
      return;
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    this.driveClient = google.drive({ version: 'v3', auth });
    this.logger.log('Google Drive client initialized');
  }

  async downloadExcelFile(fileId: string): Promise<Buffer | null> {
    if (!this.driveClient) {
      this.logger.error('Drive client is not initialized.');
      return null;
    }

    try {
      this.logger.log(`Downloading file with ID: ${fileId}...`);
      const response = await this.driveClient.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );

      this.logger.log('File successfully downloaded.');
      return Buffer.from(response.data as ArrayBuffer);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to download Google Drive file: ${error.message}`, error.stack);
      } else {
        this.logger.error('Failed to download Google Drive file: Unknown error', String(error));
      }
      return null;
    }
  }
}
