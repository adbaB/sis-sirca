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

  // Sequential queue to prevent concurrent appends from overwriting the same row.
  // Google Sheets resolves the "next empty row" at request time; if multiple
  // requests arrive simultaneously they all target the same row.
  private appendQueue: Promise<void> = Promise.resolve();

  async appendRow(range: string, values: (string | number)[]): Promise<void> {
    // Wrap the actual API call in a closure
    const execute = async (): Promise<void> => {
      try {
        this.logger.log(`Encolando fila en Google Sheets (range: ${range})...`);
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
    };

    // Chain onto the queue: wait for previous task (ignore its failure) then run ours.
    const previous = this.appendQueue;
    const current = previous.catch(() => {}).then(() => execute());
    this.appendQueue = current.catch(() => {}); // Keep the chain alive even if one task fails

    return current;
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

  async updateSurplusStatus(surplusId: string, newStatus: string): Promise<void> {
    try {
      // Leer todas las filas para encontrar el surplusId en la columna I (índice 8)
      const rows = await this.readRows('Sobrantes!A:I');

      const rowIndex = rows.findIndex((row) => row[8] === surplusId);

      if (rowIndex === -1) {
        this.logger.warn(
          `No se encontró el surplusId ${surplusId} en Google Sheets para actualizar su estado a ${newStatus}.`,
        );
        return;
      }

      // El rango a actualizar es la columna G (Estado) en la fila encontrada (es 1-indexed, así que rowIndex + 1)
      const updateRange = `Sobrantes!G${rowIndex + 1}`;

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: updateRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[newStatus]],
        },
      });

      this.logger.log(
        `Estado del surplus ${surplusId} actualizado a ${newStatus} en Google Sheets.`,
      );
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error al actualizar estado del surplus en Google Sheets: ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(
          'Error al actualizar estado del surplus en Google Sheets: Unknown error',
          String(error),
        );
      }
      // No lanzamos el error para evitar interrumpir el flujo principal de bd si falla sheets
    }
  }

  async updateCell(range: string, value: string | number): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[value]],
        },
      });
      this.logger.log(`Celda ${range} actualizada exitosamente.`);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error al actualizar celda en Google Sheets: ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(
          'Error al actualizar celda en Google Sheets: Unknown error',
          String(error),
        );
      }
      throw error;
    }
  }

  async updateRange(range: string, values: (string | number)[][]): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values,
        },
      });
      this.logger.log(`Rango ${range} actualizado exitosamente.`);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error al actualizar rango en Google Sheets: ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(
          'Error al actualizar rango en Google Sheets: Unknown error',
          String(error),
        );
      }
      throw error;
    }
  }
}
