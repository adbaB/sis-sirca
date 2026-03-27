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
    this.spreadsheetId = this.config.googleSpreadsheetId;

    // Autenticación con Service Account
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: this.config.googleClientEmail,
        // Es necesario limpiar los saltos de línea escapados en variables de entorno
        private_key: this.config.googlePrivateKey?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async appendRow(range: string, values: any[]) {
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
      this.logger.error(
        `Error al insertar en Google Sheets: ${(error as any).message}`,
        (error as any).stack,
      );
    }
  }

  async readRows(range: string): Promise<any[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });
      return response.data.values || [];
    } catch (error) {
      this.logger.error(
        `Error leyendo de Google Sheets: ${(error as any).message}`,
        (error as any).stack,
      );
      return [];
    }
  }
}
