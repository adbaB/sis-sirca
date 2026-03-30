import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import systemConfig from '../../config/configurations';

@Injectable()
export class GoogleSheetsService implements OnModuleInit {
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;
  private readonly logger = new Logger(GoogleSheetsService.name);

  constructor(
    @Inject(systemConfig.KEY)
    private config: ConfigType<typeof systemConfig>,
  ) {}

  onModuleInit() {
    this.spreadsheetId = this.config.google.spreadsheetId;

    // Autenticación con Service Account
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: this.config.google.clientEmail,
        // La variable ya se limpia de \n en configurations.ts
        private_key: this.config.google.privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async appendRow(range: string, values: (string | number)[]) {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [values],
        },
      });
      this.logger.log('Fila agregada exitosamente a Google Sheets.');
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Error al insertar en Google Sheets: ${error.message}`, error.stack);
      } else {
        this.logger.error('Error al insertar en Google Sheets: Unknown error', String(error));
      }
      throw error;
    }
  }

  async readRows(range: string): Promise<string[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });
      // The API returns an array of arrays of strings or numbers, but typically they are parsed as strings/any. We assert to a compatible type.
      return (response.data.values as string[][]) || [];
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Error leyendo de Google Sheets: ${error.message}`, error.stack);
      } else {
        this.logger.error('Error leyendo de Google Sheets: Unknown error', String(error));
      }
      return [];
    }
  }
}
