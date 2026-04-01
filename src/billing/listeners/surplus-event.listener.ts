import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GoogleSheetsService } from '../../google/services/google-sheets.service';
import { SurplusCreatedEvent } from '../events/surplus-created.event';
import { SurplusAppliedEvent } from '../events/surplus-applied.event';
@Injectable()
export class SurplusEventListener {
  private readonly logger = new Logger(SurplusEventListener.name);

  constructor(private readonly googleSheetsService: GoogleSheetsService) {}

  @OnEvent('surplus.created', { async: true })
  async handleSurplusCreatedEvent(event: SurplusCreatedEvent) {
    this.logger.log(`Procesando evento de sobrante para el contrato: ${event.contractCode}`);

    const dateObj = new Date(event.date);

    // Uso de métodos locales para mantener el formato esperado (es-ES)
    const fecha = dateObj.toLocaleDateString('es-ES', { timeZone: 'America/Caracas' });
    const hora = dateObj.toLocaleTimeString('es-ES', { timeZone: 'America/Caracas' });

    // Column order para sobrantes:
    // A=Fecha, B=Hora, C=Contrato, D=Monto$, E=MontoBs, F=URL, G=Estado, H=Referencia, I=SurplusID
    const rowValues = [
      fecha,
      hora,
      event.contractCode,
      event.amountUsd ?? '',
      event.amountVes ?? '',
      event.receiptUrl || '',
      'Pendiente',
      event.reference,
      event.surplusId,
    ];

    await this.googleSheetsService.appendRow('Sobrantes!A:I', rowValues);
  }

  @OnEvent('surplus.applied', { async: true })
  async handleSurplusAppliedEvent(event: SurplusAppliedEvent) {
    this.logger.log(`Procesando evento de aplicación de sobrante para ID: ${event.surplusId}`);
    await this.googleSheetsService.updateSurplusStatus(event.surplusId, 'Aplicado');
  }
}
