import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { drive_v3, google } from 'googleapis';
import config from '../../config/configurations';

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
    const { clientEmail, privateKey, clientId } = this.configService.drive;

    if (!clientEmail || !privateKey) {
      this.logger.warn(
        'Google Drive credentials not fully configured. Service will not fetch files.',
      );
      return;
    }

    const auth = new google.auth.JWT({
      client_id: clientId,
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
      const response = await this.driveClient.files.export(
        {
          fileId: fileId,
          // Especificamos que queremos que lo convierta a Excel
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        {
          responseType: 'arraybuffer', // Importante para manejar el archivo en memoria
        },
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
