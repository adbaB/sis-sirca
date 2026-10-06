import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { CARACAS_ZONE, formatDateES, getCaracasTodayJSDate } from '../common/utils/date.util';
import { AffiliationHistory } from '../contracts/entities/affiliation-history.entity';
import { AffiliationAction } from '../contracts/enums/affiliation-action.enum';
import { PdfService } from '../pdf/services/pdf.service';
import {
  applyDataCellStyle,
  applyTableHeaderStyle,
  applyTitleRowStyle,
  BRAND_COLORS,
  finishWorkbook,
  getGeneratedAtTimestamp,
  loadLogoBase64,
} from './report-utils';

export interface AffiliationItem {
  contractCode: string;
  identityCard: string;
  fullName: string;
  planName: string;
  actionDateFormatted: string;
  actionDateRaw: Date;
}

export interface DisaffiliationItem extends AffiliationItem {
  reason: string;
}

export interface AffiliationsReportData {
  startDate: string;
  endDate: string;
  startDateFormatted: string;
  endDateFormatted: string;
  generatedAt: string;
  totalAffiliations: number;
  totalDisaffiliations: number;
  affiliations: AffiliationItem[];
  disaffiliations: DisaffiliationItem[];
  hasAffiliations: boolean;
  hasDisaffiliations: boolean;
  logo?: string;
}

@Injectable()
export class AffiliationsReportService {
  private readonly logger = new Logger(AffiliationsReportService.name);

  constructor(
    @InjectRepository(AffiliationHistory)
    private readonly affiliationHistoryRepository: Repository<AffiliationHistory>,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Valida y analiza el rango de fechas recibido en zona horaria America/Caracas.
   */
  private parseDateRange(
    startDateStr: string,
    endDateStr: string,
  ): { startDt: DateTime; endDt: DateTime; startOfDay: Date; endOfDay: Date } {
    if (!startDateStr || !endDateStr) {
      throw new BadRequestException(
        'Se requieren las fechas startDate y endDate en formato YYYY-MM-DD.',
      );
    }

    const startDt = DateTime.fromISO(startDateStr, { zone: CARACAS_ZONE });
    const endDt = DateTime.fromISO(endDateStr, { zone: CARACAS_ZONE });

    if (!startDt.isValid || !endDt.isValid) {
      throw new BadRequestException(
        'Las fechas proporcionadas no tienen un formato válido (YYYY-MM-DD).',
      );
    }

    if (startDt.startOf('day') > endDt.endOf('day')) {
      throw new BadRequestException(
        'La fecha inicial (startDate) no puede ser posterior a la fecha final (endDate).',
      );
    }

    const startOfDay = startDt.startOf('day').toJSDate();
    const endOfDay = endDt.endOf('day').toJSDate();

    return { startDt, endDt, startOfDay, endOfDay };
  }

  /**
   * Obtiene y estructura los datos para el reporte de afiliaciones y desafiliaciones.
   */
  async getReportData(startDateStr: string, endDateStr: string): Promise<AffiliationsReportData> {
    const { startDt, endDt, startOfDay, endOfDay } = this.parseDateRange(startDateStr, endDateStr);

    const histories = await this.affiliationHistoryRepository
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.contract', 'contract')
      .leftJoinAndSelect('h.person', 'person')
      .leftJoinAndSelect('h.plan', 'plan')
      .where('h.action_date >= :startOfDay AND h.action_date <= :endOfDay', {
        startOfDay,
        endOfDay,
      })
      .andWhere('h.is_reverted = false')
      .andWhere('h.action IN (:...actions)', {
        actions: [AffiliationAction.AFILIACION, AffiliationAction.DESAFILIACION],
      })
      .orderBy('h.action_date', 'DESC')
      .getMany();

    const affiliations: AffiliationItem[] = [];
    const disaffiliations: DisaffiliationItem[] = [];

    for (const h of histories) {
      const contractCode = h.contract?.code || 'N/A';
      const identityCard = h.person
        ? `${h.person.typeIdentityCard}-${h.person.identityCard}`
        : 'N/A';
      const fullName = h.person?.name || 'N/A';
      const planName = h.plan?.name || 'Sin plan asignado';
      const actionDateFormatted = formatDateES(h.actionDate, 'dd/MM/yyyy');

      if (h.action === AffiliationAction.AFILIACION) {
        affiliations.push({
          contractCode,
          identityCard,
          fullName,
          planName,
          actionDateFormatted,
          actionDateRaw: h.actionDate,
        });
      } else if (h.action === AffiliationAction.DESAFILIACION) {
        disaffiliations.push({
          contractCode,
          identityCard,
          fullName,
          planName,
          actionDateFormatted,
          actionDateRaw: h.actionDate,
          reason: h.reason || 'Sin motivo especificado',
        });
      }
    }

    return {
      startDate: startDateStr,
      endDate: endDateStr,
      startDateFormatted: startDt.toFormat('dd/MM/yyyy'),
      endDateFormatted: endDt.toFormat('dd/MM/yyyy'),
      generatedAt: getGeneratedAtTimestamp(),
      totalAffiliations: affiliations.length,
      totalDisaffiliations: disaffiliations.length,
      affiliations,
      disaffiliations,
      hasAffiliations: affiliations.length > 0,
      hasDisaffiliations: disaffiliations.length > 0,
    };
  }

  /**
   * Genera el archivo Excel (.xlsx) con dos pestañas ('Afiliaciones' y 'Desafiliaciones').
   */
  async generateExcel(startDateStr: string, endDateStr: string): Promise<Buffer> {
    const data = await this.getReportData(startDateStr, endDateStr);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SIRCA - Sistema Integral';
    workbook.created = getCaracasTodayJSDate();

    // ─────────────────────────────────────────────────────────
    // Pestaña 1: Afiliaciones
    // ─────────────────────────────────────────────────────────
    const wsAfiliaciones = workbook.addWorksheet('Afiliaciones', {
      properties: { defaultColWidth: 16 },
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });

    this.buildWorksheetHeader(
      wsAfiliaciones,
      'REPORTE DE AFILIACIONES',
      data.startDateFormatted,
      data.endDateFormatted,
      data.generatedAt,
      `Total de Afiliaciones: ${data.totalAffiliations}`,
      5,
    );

    // Encabezados de columnas
    const affHeaderRow = wsAfiliaciones.getRow(5);
    affHeaderRow.values = [
      'N° Contrato',
      'Cédula de Identidad',
      'Nombre del Afiliado',
      'Plan de Salud',
      'Fecha de Afiliación',
    ];
    for (let c = 1; c <= 5; c++) {
      applyTableHeaderStyle(affHeaderRow.getCell(c));
    }
    affHeaderRow.height = 24;

    // Filas de datos
    let affCurrentRow = 6;
    if (data.affiliations.length === 0) {
      wsAfiliaciones.mergeCells('A6:E6');
      const emptyCell = wsAfiliaciones.getCell('A6');
      emptyCell.value = 'No se registraron afiliaciones en el período seleccionado.';
      emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
      emptyCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF666666' } };
      applyDataCellStyle(emptyCell);
      wsAfiliaciones.getRow(6).height = 22;
    } else {
      for (const item of data.affiliations) {
        const row = wsAfiliaciones.getRow(affCurrentRow);
        row.values = [
          item.contractCode,
          item.identityCard,
          item.fullName,
          item.planName,
          item.actionDateFormatted,
        ];
        for (let c = 1; c <= 5; c++) {
          const cell = row.getCell(c);
          applyDataCellStyle(cell);
          if (c === 1 || c === 2 || c === 5) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        }
        row.height = 20;
        affCurrentRow++;
      }
    }

    this.autoFitColumnWidths(wsAfiliaciones, 5);

    // ─────────────────────────────────────────────────────────
    // Pestaña 2: Desafiliaciones
    // ─────────────────────────────────────────────────────────
    const wsDesafiliaciones = workbook.addWorksheet('Desafiliaciones', {
      properties: { defaultColWidth: 16 },
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });

    this.buildWorksheetHeader(
      wsDesafiliaciones,
      'REPORTE DE DESAFILIACIONES',
      data.startDateFormatted,
      data.endDateFormatted,
      data.generatedAt,
      `Total de Desafiliaciones: ${data.totalDisaffiliations}`,
      6,
    );

    // Encabezados de columnas
    const desafHeaderRow = wsDesafiliaciones.getRow(5);
    desafHeaderRow.values = [
      'N° Contrato',
      'Cédula de Identidad',
      'Nombre del Desafiliado',
      'Plan de Salud',
      'Fecha de Desafiliación',
      'Motivo / Razón',
    ];
    for (let c = 1; c <= 6; c++) {
      applyTableHeaderStyle(desafHeaderRow.getCell(c));
    }
    desafHeaderRow.height = 24;

    // Filas de datos
    let desafCurrentRow = 6;
    if (data.disaffiliations.length === 0) {
      wsDesafiliaciones.mergeCells('A6:F6');
      const emptyCell = wsDesafiliaciones.getCell('A6');
      emptyCell.value = 'No se registraron desafiliaciones en el período seleccionado.';
      emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
      emptyCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF666666' } };
      applyDataCellStyle(emptyCell);
      wsDesafiliaciones.getRow(6).height = 22;
    } else {
      for (const item of data.disaffiliations) {
        const row = wsDesafiliaciones.getRow(desafCurrentRow);
        row.values = [
          item.contractCode,
          item.identityCard,
          item.fullName,
          item.planName,
          item.actionDateFormatted,
          item.reason,
        ];
        for (let c = 1; c <= 6; c++) {
          const cell = row.getCell(c);
          applyDataCellStyle(cell);
          if (c === 1 || c === 2 || c === 5) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        }
        row.height = 20;
        desafCurrentRow++;
      }
    }

    this.autoFitColumnWidths(wsDesafiliaciones, 6);

    return finishWorkbook(workbook);
  }

  /**
   * Genera el archivo PDF (.pdf) con la plantilla Handlebars.
   */
  async generatePdf(startDateStr: string, endDateStr: string): Promise<Buffer> {
    const data = await this.getReportData(startDateStr, endDateStr);
    const logoBase64 = await loadLogoBase64(this.logger);

    return this.pdfService.generatePdf(
      'affiliations-report',
      {
        ...data,
        logo: logoBase64,
      },
      { landscape: true },
    );
  }

  /**
   * Helper para construir la cabecera estilizada de cada hoja de cálculo.
   */
  private buildWorksheetHeader(
    ws: ExcelJS.Worksheet,
    title: string,
    startDateFormatted: string,
    endDateFormatted: string,
    generatedAt: string,
    metricText: string,
    totalColumns: number,
  ): void {
    const endColLetter = String.fromCharCode(64 + totalColumns);

    // Título Principal
    ws.mergeCells(`A1:${endColLetter}1`);
    const titleCell = ws.getCell('A1');
    titleCell.value = `SIRCA - ${title}`;
    applyTitleRowStyle(titleCell);
    ws.getRow(1).height = 30;

    // Período
    ws.mergeCells(`A2:${endColLetter}2`);
    const periodCell = ws.getCell('A2');
    periodCell.value = `Período: Del ${startDateFormatted} al ${endDateFormatted}  |  Generado: ${generatedAt}`;
    periodCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } };
    periodCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 18;

    // Tarjeta métrica de resumen
    ws.mergeCells(`A3:${endColLetter}3`);
    const metricCell = ws.getCell('A3');
    metricCell.value = metricText;
    metricCell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: `FF${BRAND_COLORS.primaryGreen}` },
    };
    metricCell.alignment = { horizontal: 'center', vertical: 'middle' };
    metricCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${BRAND_COLORS.subtotalGreen}` },
    };
    metricCell.border = {
      top: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
      bottom: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
      left: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
      right: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    };
    ws.getRow(3).height = 22;

    // Fila 4 vacía como separador
    ws.getRow(4).height = 10;
  }

  /**
   * Helper para ajustar el ancho de las columnas según su contenido.
   */
  private autoFitColumnWidths(ws: ExcelJS.Worksheet, maxCols: number): void {
    for (let c = 1; c <= maxCols; c++) {
      const col = ws.getColumn(c);
      let maxLength = 14;
      col.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
        // Ignorar filas de encabezado mergeado (1 a 4)
        if (rowNumber >= 5 && cell.value) {
          const cellLength = String(cell.value).length;
          if (cellLength > maxLength) {
            maxLength = cellLength;
          }
        }
      });
      col.width = Math.min(Math.max(maxLength + 3, 15), 45);
    }
  }
}
