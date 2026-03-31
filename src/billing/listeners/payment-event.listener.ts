import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GoogleSheetsService } from '../../google/services/google-sheets.service';
import { PaymentRegisteredEvent } from '../events/payment-registered.event';

@Injectable()
export class PaymentEventListener {
  private readonly logger = new Logger(PaymentEventListener.name);

  constructor(private readonly googleSheetsService: GoogleSheetsService) {}

  @OnEvent('payment.registered', { async: true })
  async handlePaymentRegisteredEvent(event: PaymentRegisteredEvent) {
    this.logger.log(`Procesando evento de pago para la referencia: ${event.reference}`);

    const dateObj = new Date(event.createdAt);

    // Uso de métodos locales para mantener el formato esperado (es-ES)
    const fecha = dateObj.toLocaleDateString('es-ES', { timeZone: 'America/Caracas' });
    const hora = dateObj.toLocaleTimeString('es-ES', { timeZone: 'America/Caracas' });

    // Column order:
    // A=Contrato, B=Nombre, C=Fecha, D=Hora, E=Referencia,
    // F=Monto$, G=MontoBs, H=URL, I=Estado, J=PaymentID
    const rowValues = [
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
    ];

    await this.googleSheetsService.appendRow('Pagos!A:J', rowValues);
  }
}
