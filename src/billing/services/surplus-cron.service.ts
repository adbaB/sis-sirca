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

    // Read up to col I (index 8) to capture the SurplusID stored in the last column.
    // The columns are: A=Fecha, B=Hora, C=Contrato, D=Monto$, E=MontoBs, F=URL, G=Estado, H=Referencia, I=SurplusID
    const rows = await this.googleSheetsService.readRows('Sobrantes!A2:I');

    if (!rows || rows.length === 0) {
      return;
    }

    for (const row of rows) {
      const estadoHoja = row[6] as string | undefined;
      const referencia = row[7] as string | undefined;
      const surplusId = row[8] as string | undefined;

      if (!surplusId || !estadoHoja) {
        continue;
      }

      const targetStatus = SHEET_SURPLUS_STATUS_MAP[estadoHoja];

      if (targetStatus === undefined || targetStatus === null) {
        continue;
      }

      const surplus = await this.surplusRepository.findOne({
        where: { id: surplusId },
      });

      if (!surplus) {
        this.logger.warn(
          `[CRON] Estado "${estadoHoja}" detectado pero no existe sobrante con ID "${surplusId}" (ref: ${referencia}). Ignorando.`,
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
