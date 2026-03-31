import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleSheetsService } from '../../google/services/google-sheets.service';
import { Surplus, SurplusStatus } from '../entities/surplus.entity';

const SHEET_SURPLUS_STATUS_MAP: Record<string, SurplusStatus | null> = {
  Pendiente: SurplusStatus.PENDING,
  Aplicado: SurplusStatus.APPLIED,
  Reembolsado: SurplusStatus.REFUNDED,
  Anulado: SurplusStatus.CANCELLED,
};

@Injectable()
export class SurplusCronService {
  private readonly logger = new Logger(SurplusCronService.name);

  constructor(
    private readonly googleSheetsService: GoogleSheetsService,
    @InjectRepository(Surplus)
    private readonly surplusRepository: Repository<Surplus>,
  ) {}

  @Cron('0 6 * * *')
  async checkSurplusStatusTransitions() {
    this.logger.log('Iniciando CRON: Revisión de estados de sobrantes en Google Sheets...');

    // Read up to col H (index 7) to capture the reference stored in the last column.
    // The columns are: A=Fecha, B=Hora, C=Contrato, D=Monto$, E=MontoBs, F=URL, G=Estado, H=Referencia
    const rows = await this.googleSheetsService.readRows('Sobrantes!A2:H');

    if (!rows || rows.length === 0) {
      return;
    }

    for (const row of rows) {
      const estadoHoja = row[6] as string | undefined;
      const referencia = row[7] as string | undefined;

      if (!referencia || !estadoHoja) {
        continue;
      }

      const targetStatus = SHEET_SURPLUS_STATUS_MAP[estadoHoja];

      if (targetStatus === undefined || targetStatus === null) {
        continue;
      }

      // Note: We use the reference to find the surplus. We assume one surplus per payment reference for simplicity.
      const surplus = await this.surplusRepository.findOne({
        where: { payment: { referenceNumber: referencia } },
        relations: ['payment'],
      });

      if (!surplus) {
        this.logger.warn(
          `[CRON] Estado "${estadoHoja}" detectado pero no existe sobrante asociado al pago con referencia "${referencia}". Ignorando.`,
        );
        continue;
      }

      if (surplus.status === targetStatus) {
        continue;
      }

      surplus.status = targetStatus;
      await this.surplusRepository.save(surplus);

      this.logger.log(
        `[CRON] Transición de sobrante detectada para ref ${referencia}: nuevo estado ${targetStatus}.`,
      );
    }
  }
}
