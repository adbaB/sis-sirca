import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { GoogleSheetsService } from '../../google/services/google-sheets.service';
import { PaymentRegisteredEvent } from '../events/payment-registered.event';

@Injectable()
export class PaymentEventListener {
  private readonly logger = new Logger(PaymentEventListener.name);

  constructor(private readonly googleSheetsService: GoogleSheetsService) {}

  @OnEvent('payment.registered', { async: true })
  async handlePaymentRegisteredEvent(event: PaymentRegisteredEvent) {
    this.logger.log(`Procesando evento de pago para la referencia: ${event.reference}`);

    const dateObj = DateTime.fromJSDate(new Date(event.createdAt)).setZone('America/Caracas');

    // Mantenemos el formato esperado (es-ES) usando luxon para asegurar la precisión de la zona horaria
    const fecha = dateObj.toFormat('dd/MM/yyyy');
    const hora = dateObj.toFormat('HH:mm:ss');

    const rowValues = this.buildRowValues(event, fecha, hora);
    await this.googleSheetsService.appendRow('Pagos!A:O', rowValues);
  }

  private buildRowValues(event: PaymentRegisteredEvent, fecha: string, hora: string) {
    // Column order:
    // A=Contrato, B=Nombre, C=Fecha, D=Hora, E=Referencia,
    // F=Monto$, G=MontoBs, H=URL, I=Estado, J=PaymentID, K=FechaComprobante, L=TotalFactura, M=Planes, N=Asesor
    return [
      event.contractCode || '',
      event.personName || '',
      fecha,
      hora,
      event.reference,
      event.amountUsd,
      event.amountVes,
      event.receiptUrl || '',
      'Pendiente',
      event.paymentId,
      event.dateReceipt,
      event.totalInvoice,
      event.planNames || '',
      event.advisorName || '',
      event.billingMonth || '',
    ];
  }
}
