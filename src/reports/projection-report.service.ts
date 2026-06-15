import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PdfService } from '../pdf/services/pdf.service';
import {
  applyDataCellStyle,
  applyGrandTotalStyle,
  applySectionHeaderStyle,
  applySubtotalCellStyle,
  applyTableHeaderStyle,
  applyTitleRowStyle,
  BRAND_COLORS,
  createWorkbook,
  fetchAdvisorName,
  finishWorkbook,
  formatDateES,
  getGeneratedAtTimestamp,
  loadLogoBase64,
} from './report-utils';

interface ProjectionQueryRow {
  contract_code: string;
  affiliation_date: string | Date | null;
  person_name: string;
  type_identity_card: string | null;
  identity_card: string | null;
  plan_name: string;
  plan_amount: number | string;
  contract_total_amount: number | string;
  portfolio_code: string;
  advisor_name: string;
}

interface ProjectionRow {
  contractCode: string;
  affiliationDate: string;
  affiliationDateES: string;
  personName: string;
  typeIdentityCard: string;
  identityCard: string;
  planName: string;
  planAmount: number;
  planAmountFormatted: string;
  contractTotalRaw?: number;
  contractTotalAmount: number | null;
  contractTotalAmountFormatted: string;
  portfolioCode: string;
  advisorName: string;
}

interface PortfolioSection {
  portfolioCode: string;
  rows: ProjectionRow[];
  subtotalCount: number;
  subtotalAmount: number;
  subtotalAmountFormatted: string;
}

interface ProjectionReportData {
  advisorName: string;
  sections: PortfolioSection[];
  grandTotalCount: number;
  grandTotalAmount: number;
  grandTotalAmountFormatted: string;
}

@Injectable()
export class ProjectionReportService {
  private readonly logger = new Logger(ProjectionReportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Build report projection data.
   */
  async buildReportData(advisorId?: string): Promise<ProjectionReportData> {
    // 1. Fetch advisor name if provided
    let advisorName: string;
    try {
      advisorName = await fetchAdvisorName(this.dataSource, advisorId);
    } catch (err) {
      this.logger.error('Error fetching advisor name for projection report:', err);
      throw new InternalServerErrorException('Error al obtener el nombre del asesor.');
    }

    // 2. Query active contract members, their plans, portfolio, and advisor
    let sql = `
      SELECT
        c.code AS contract_code,
        c.affiliation_date,
        p.name AS person_name,
        p.type_identity_card,
        p.identity_card,
        pl.name AS plan_name,
        pl.amount AS plan_amount,
        SUM(pl.amount) OVER(PARTITION BY c.id) AS contract_total_amount,
        COALESCE(pf.code, 'SIN_CARTERA') AS portfolio_code,
        COALESCE(adv.name, 'Sin asesor') AS advisor_name
      FROM contracts c
      JOIN contract_persons cp ON cp.contract_id = c.id AND cp.deleted_at IS NULL
      JOIN persons p ON cp.person_id = p.id AND p.deleted_at IS NULL
      JOIN plans pl ON p.plan_id = pl.id AND pl.deleted_at IS NULL
      LEFT JOIN portfolios pf ON c.portfolio_id = pf.id
      LEFT JOIN advisors adv ON c.advisor_id = adv.id AND adv.deleted_at IS NULL
      WHERE c.status = 'ACTIVE'
        AND c.deleted_at IS NULL
    `;

    const params: string[] = [];
    if (advisorId) {
      sql += ' AND c.advisor_id = $1';
      params.push(advisorId);
    }

    sql += " ORDER BY COALESCE(pf.code, 'SIN_CARTERA') ASC, c.code ASC, p.name ASC";

    let rawData: ProjectionQueryRow[];
    try {
      rawData = await this.dataSource.query(sql, params);
    } catch (err) {
      this.logger.error('Error querying active contract members for projection report:', err);
      throw new InternalServerErrorException(
        'Error al obtener los datos de la proyección de cobros.',
      );
    }

    // 3. Group by portfolio code
    const portfolioGroups = new Map<string, ProjectionRow[]>();

    for (const row of rawData) {
      const portfolioCode = row.portfolio_code;
      let group = portfolioGroups.get(portfolioCode);
      if (!group) {
        group = [];
        portfolioGroups.set(portfolioCode, group);
      }

      const affiliationDateES = row.affiliation_date ? formatDateES(row.affiliation_date) : 'S/F';

      group.push({
        contractCode: row.contract_code,
        affiliationDate: row.affiliation_date ? String(row.affiliation_date) : '',
        affiliationDateES,
        personName: row.person_name,
        typeIdentityCard: row.type_identity_card || 'V',
        identityCard: row.identity_card || '',
        planName: row.plan_name,
        planAmount: Number(row.plan_amount || 0),
        planAmountFormatted: Number(row.plan_amount || 0).toFixed(2),
        contractTotalRaw: Number(row.contract_total_amount || 0),
        contractTotalAmount: null,
        contractTotalAmountFormatted: '',
        portfolioCode,
        advisorName: row.advisor_name,
      });
    }

    // 4. Calculate subtotals and grand totals
    const sections: PortfolioSection[] = [];
    let grandTotalCount = 0;
    let grandTotalAmount = 0;

    for (const [portfolioCode, rows] of portfolioGroups.entries()) {
      const subtotalCount = rows.length;
      const subtotalAmount = rows.reduce((sum, r) => sum + r.planAmount, 0);

      grandTotalCount += subtotalCount;
      grandTotalAmount += subtotalAmount;

      // Identify the last member of each contract to assign the total contract amount
      for (let i = 0; i < rows.length; i++) {
        const isLastMember =
          i === rows.length - 1 || rows[i + 1].contractCode !== rows[i].contractCode;
        if (isLastMember) {
          const totalVal = rows[i].contractTotalRaw || 0;
          rows[i].contractTotalAmount = totalVal;
          rows[i].contractTotalAmountFormatted = totalVal.toFixed(2);
        } else {
          rows[i].contractTotalAmount = null;
          rows[i].contractTotalAmountFormatted = '';
        }
        // Cleanup temp field
        delete rows[i].contractTotalRaw;
      }

      sections.push({
        portfolioCode,
        rows,
        subtotalCount,
        subtotalAmount,
        subtotalAmountFormatted: subtotalAmount.toFixed(2),
      });
    }

    // Sort sections alphabetically by portfolioCode
    sections.sort((a, b) => a.portfolioCode.localeCompare(b.portfolioCode));

    return {
      advisorName,
      sections,
      grandTotalCount,
      grandTotalAmount,
      grandTotalAmountFormatted: grandTotalAmount.toFixed(2),
    };
  }

  /**
   * Generate projection report in Excel format.
   */
  async generateExcel(advisorId?: string): Promise<Buffer> {
    const report = await this.buildReportData(advisorId);
    const { workbook, ws } = createWorkbook('PROYECCIÓN DE COBROS');

    const totalCols = 8;

    // A. TITLE
    const titleRow = ws.addRow(['PROYECCIÓN DE INGRESOS MENSUALES']);
    ws.mergeCells(1, 1, 1, totalCols);
    applyTitleRowStyle(titleRow.getCell(1));
    titleRow.height = 40;

    // B. SUBHEADERS
    const advisorRow = ws.addRow([`Asesor: ${report.advisorName}`]);
    ws.mergeCells(2, 1, 2, totalCols);
    advisorRow.getCell(1).font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: `FF${BRAND_COLORS.darkText}` },
    };
    advisorRow.getCell(1).alignment = { horizontal: 'left' };
    advisorRow.height = 20;

    ws.addRow([]); // Blank row
    let currentRowIdx = 4;

    // C. LOOP THROUGH CARTERAS
    for (const section of report.sections) {
      if (section.rows.length === 0) continue;

      // Section Header (Portfolio code)
      currentRowIdx++;
      const secHeaderRow = ws.addRow([`CARTERA: ${section.portfolioCode}`]);
      ws.mergeCells(currentRowIdx, 1, currentRowIdx, totalCols);
      applySectionHeaderStyle(secHeaderRow.getCell(1));
      secHeaderRow.height = 25;

      // Table Headers
      currentRowIdx++;
      const headers = [
        'CONTRATO',
        'FECHA AFILIACIÓN',
        'CÉDULA / RIF',
        'NOMBRE COMPLETO',
        'PLAN',
        'ASESOR',
        'IMPORTE MENSUAL ($)',
        'TOTAL CONTRATO ($)',
      ];
      const headerRow = ws.addRow(headers);
      headerRow.height = 22;
      for (let c = 1; c <= totalCols; c++) {
        const cell = headerRow.getCell(c);
        applyTableHeaderStyle(cell);
      }

      // Table Body Rows
      for (const rowObj of section.rows) {
        currentRowIdx++;
        const rowData = [
          rowObj.contractCode,
          rowObj.affiliationDateES,
          `${rowObj.typeIdentityCard}-${rowObj.identityCard}`,
          rowObj.personName,
          rowObj.planName,
          rowObj.advisorName,
          rowObj.planAmount,
          rowObj.contractTotalAmount,
        ];
        const row = ws.addRow(rowData);
        row.height = 20;

        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(3).alignment = { horizontal: 'center' };
        row.getCell(4).alignment = { horizontal: 'left' };
        row.getCell(5).alignment = { horizontal: 'center' };
        row.getCell(6).alignment = { horizontal: 'center' };
        row.getCell(7).alignment = { horizontal: 'right' };
        row.getCell(7).numFmt = '$#,##0.00';
        row.getCell(8).alignment = { horizontal: 'right' };
        row.getCell(8).numFmt = '$#,##0.00';

        for (let c = 1; c <= totalCols; c++) {
          const cell = row.getCell(c);
          applyDataCellStyle(cell);
        }
      }

      // Subtotals Row
      currentRowIdx++;
      const subtotalRow = ws.addRow([
        'Subtotal Cartera',
        '',
        `${section.subtotalCount} Miembro(s)`,
        '',
        '',
        '',
        section.subtotalAmount,
        section.subtotalAmount,
      ]);
      ws.mergeCells(currentRowIdx, 1, currentRowIdx, 2);
      ws.mergeCells(currentRowIdx, 3, currentRowIdx, 6);
      subtotalRow.height = 22;

      subtotalRow.getCell(1).font = { name: 'Calibri', size: 10, bold: true };
      subtotalRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

      subtotalRow.getCell(3).font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: `FF${BRAND_COLORS.mediumText}` },
      };
      subtotalRow.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };

      subtotalRow.getCell(7).font = { name: 'Calibri', size: 10, bold: true };
      subtotalRow.getCell(7).alignment = { horizontal: 'right', vertical: 'middle' };
      subtotalRow.getCell(7).numFmt = '$#,##0.00';

      subtotalRow.getCell(8).font = { name: 'Calibri', size: 10, bold: true };
      subtotalRow.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };
      subtotalRow.getCell(8).numFmt = '$#,##0.00';

      for (let c = 1; c <= totalCols; c++) {
        const cell = subtotalRow.getCell(c);
        applySubtotalCellStyle(cell);
      }

      currentRowIdx++;
      ws.addRow([]); // Blank row
    }

    // D. GRAND TOTALS
    currentRowIdx++;
    ws.addRow([]);

    currentRowIdx++;
    const gtCountRow = ws.addRow([
      'CANTIDAD TOTAL DE AFILIADOS PROYECTADOS:',
      '',
      '',
      '',
      '',
      '',
      '',
      report.grandTotalCount,
    ]);
    ws.mergeCells(currentRowIdx, 1, currentRowIdx, 7);
    gtCountRow.height = 24;
    applyGrandTotalStyle(gtCountRow.getCell(1), 'right');
    gtCountRow.getCell(1).font = { ...gtCountRow.getCell(1).font, size: 11 };
    applyGrandTotalStyle(gtCountRow.getCell(8), 'center');
    gtCountRow.getCell(8).font = { ...gtCountRow.getCell(8).font, size: 11 };

    currentRowIdx++;
    const gtAmountRow = ws.addRow([
      'MONTO TOTAL DE INGRESOS PROYECTADOS ($):',
      '',
      '',
      '',
      '',
      '',
      '',
      report.grandTotalAmount,
    ]);
    ws.mergeCells(currentRowIdx, 1, currentRowIdx, 7);
    gtAmountRow.height = 24;
    applyGrandTotalStyle(gtAmountRow.getCell(1), 'right');
    gtAmountRow.getCell(1).font = { ...gtAmountRow.getCell(1).font, size: 11 };
    applyGrandTotalStyle(gtAmountRow.getCell(8), 'center');
    gtAmountRow.getCell(8).font = { ...gtAmountRow.getCell(8).font, size: 11 };
    gtAmountRow.getCell(8).numFmt = '$#,##0.00';

    // Set precise columns widths
    ws.getColumn(1).width = 18; // Contrato
    ws.getColumn(2).width = 20; // Fecha Afiliación
    ws.getColumn(3).width = 18; // Cédula / RIF
    ws.getColumn(4).width = 35; // Nombre Completo
    ws.getColumn(5).width = 25; // Plan
    ws.getColumn(6).width = 20; // Asesor
    ws.getColumn(7).width = 22; // Importe Mensual
    ws.getColumn(8).width = 22; // Total Contrato

    return finishWorkbook(workbook);
  }

  /**
   * Generate projection report in PDF format.
   */
  async generatePdf(advisorId?: string): Promise<Buffer> {
    const report = await this.buildReportData(advisorId);
    const generatedAt = getGeneratedAtTimestamp();
    const logoBase64 = await loadLogoBase64(this.logger);

    const templateData = {
      logo: logoBase64 || null,
      generatedAt,
      advisorName: report.advisorName,
      sections: report.sections,
      grandTotalCount: report.grandTotalCount,
      grandTotalAmountFormatted: report.grandTotalAmountFormatted,
    };

    return this.pdfService.generatePdf('projection-report', templateData, { landscape: true });
  }
}
