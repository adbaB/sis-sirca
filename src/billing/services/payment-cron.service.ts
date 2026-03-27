import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GoogleSheetsService } from '../../google-sheets/services/google-sheets.service';

@Injectable()
export class PaymentCronService {
  private readonly logger = new Logger(PaymentCronService.name);

  constructor(
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkRejectedPayments() {
    this.logger.log('Iniciando CRON: Revisión de pagos rechazados en Google Sheets...');

    const rows = await this.googleSheetsService.readRows('Pagos!A2:G');

    if (!rows || rows.length === 0) {
      return;
    }

    for (const row of rows) {
      const referencia = row[2];
      const estado = row[6];

      if (estado === 'Rechazado') {
        this.logger.warn(`[CRON] Se detectó un pago RECHAZADO: Referencia ${referencia}`);

        // Emisión del evento interno para manejo de rechazos
        this.eventEmitter.emit('payment.rejected', {
          reference: referencia,
          detectedAt: new Date(),
        });
      }
    }
  }
}
