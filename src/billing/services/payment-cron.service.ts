import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { GoogleSheetsService } from '../../google/services/google-sheets.service';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { BillingService } from './billing.service';

/**
 * Maps a Google Sheets status string to the corresponding PaymentStatus
 * and the event name to emit on a real transition.
 * Returns null for "Pendiente" (initial state — no action needed).
 */
const SHEET_STATUS_MAP: Record<string, { dbStatus: PaymentStatus; event: string } | null> = {
  Pendiente: null, // initial state, no transition action
  Aprobado: { dbStatus: PaymentStatus.COMPLETED, event: 'payment.approved' },
  Rechazado: { dbStatus: PaymentStatus.REJECTED, event: 'payment.rejected' },
};

@Injectable()
export class PaymentCronService {
  private readonly logger = new Logger(PaymentCronService.name);

  constructor(
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly billingService: BillingService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkPaymentStatusTransitions() {
    this.logger.log('Iniciando CRON: Revisión de estados de pagos en Google Sheets...');

    const rows = await this.googleSheetsService.readRows('Pagos!A2:G');

    if (!rows || rows.length === 0) {
      return;
    }

    for (const row of rows) {
      const referencia = row[2] as string | undefined;
      const estadoHoja = row[6] as string | undefined;

      if (!referencia || !estadoHoja) {
        continue;
      }

      const target = SHEET_STATUS_MAP[estadoHoja];

      // "Pendiente" or unknown status → nothing to do
      if (target === undefined) {
        this.logger.warn(
          `[CRON] Estado desconocido en la hoja: "${estadoHoja}" (ref: ${referencia}). Ignorando.`,
        );
        continue;
      }
      if (target === null) {
        continue;
      }

      const payment = await this.paymentRepository.findOne({
        where: { referenceNumber: referencia },
        relations: ['invoice'],
      });

      if (!payment) {
        this.logger.warn(
          `[CRON] Estado "${estadoHoja}" detectado pero no existe pago con referencia "${referencia}". Ignorando.`,
        );
        continue;
      }

      // Skip if the DB already reflects this status (idempotent checkpoint)
      if (payment.status === target.dbStatus) {
        this.logger.debug(
          `[CRON] Pago ${payment.id} (ref: ${referencia}) ya tiene estado ${target.dbStatus} en la BD. Omitiendo.`,
        );
        continue;
      }

      // Persist new status before emitting so a crash can't cause a re-emit
      payment.status = target.dbStatus;
      await this.paymentRepository.save(payment);

      // Recalculate the invoice's paidAmount from the source of truth
      await this.billingService.recalculateInvoicePaidAmount(payment.invoice.id);

      this.logger.log(
        `[CRON] Transición detectada para ref ${referencia}: ${target.dbStatus}. Emitiendo "${target.event}".`,
      );

      this.eventEmitter.emit(target.event, {
        reference: referencia,
        detectedAt: new Date(),
      });
    }
  }
}
