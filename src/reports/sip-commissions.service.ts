import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { formatToISODateString, getCaracasDateTime } from '../common/utils/date.util';
import { PdfService } from '../pdf/services/pdf.service';
import {
  applyGrandTotalStyle,
  BRAND_COLORS,
  createWorkbook,
  finishWorkbook,
  formatDateES,
  getGeneratedAtTimestamp,
  loadLogoBase64,
  loadLogoImagePath,
  thinBorder,
} from './report-utils';

/** One row in the commission report grid */
interface CommissionRow {
  planName: string;
  planAmount: number;
  commissionAmount: number;
  affiliatesByPortfolio: Record<string, number>; // portfolio_code → count
  totalAffiliates: number;
  totalCommission: number;
}

/** A full section of the report */
interface ReportSection {
  title: string;
  rows: CommissionRow[];
  subtotalAffiliatesByPortfolio: Record<string, number>;
  subtotalAffiliates: number;
  subtotalCommission: number;
}

/** Complete report data */
interface SipCommissionReport {
  startDate: string;
  endDate: string;
  sections: ReportSection[];
  grandTotalCommission: number;
  portfolioCodes: string[];
}

interface SipCommissionQueryRow {
  plan_name: string;
  plan_amount: string | number;
  commission_amount: string | number;
  portfolio_code: string;
  contract_code: string;
  affiliation_date: string | Date;
  payment_date: string | Date;
  due_date: string | Date;
  issue_date: string | Date;
  affiliate_count: string | number;
}

// Use BRAND_COLORS from shared report-utils
const BRAND = {
  ...BRAND_COLORS,
  border: BRAND_COLORS.borderColor,
  altBackground: BRAND_COLORS.lightGrayBg,
};

@Injectable()
export class SipCommissionsService {
  private readonly logger = new Logger(SipCommissionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Build the complete SIP commission report data from the database.
   */
  async buildReportData(year: number, month: number): Promise<SipCommissionReport> {
    const monthStr = String(month).padStart(2, '0');
    const billingMonth = `${year}-${monthStr}`;

    const startDate = `${year}-${monthStr}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

    // 1. Get all active portfolio codes for column headers
    let portfolios: Array<{ code: string }>;
    try {
      portfolios = await this.dataSource.query(
        "SELECT code FROM portfolios WHERE status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code",
      );
    } catch (err) {
      this.logger.error('Error querying portfolios:', err);
      throw new InternalServerErrorException(
        'Error al obtener las carteras para el reporte de comisiones.',
      );
    }
    const activePortfolioCodes: string[] = portfolios.map((p) => p.code);

    // 2. Determine which contract codes are "convenio inicial" (SIR-002-001 to SIR-002-060)
    const convenioInicialPattern = '^SIR-002-0[0-5][0-9]$|^SIR-002-060$';

    // 3. Fetch all invoice lines (MENSUALIDAD only) with related data for the period
    let rawData: SipCommissionQueryRow[];
    try {
      rawData = await this.dataSource.query(
        `
        SELECT
          p.name       AS plan_name,
          p.amount     AS plan_amount,
          p.commission_amount,
          COALESCE(pf.code, 'SIN_CARTERA') AS portfolio_code,
          c.code       AS contract_code,
          c.affiliation_date,
          pay.payment_date,
          inv.due_date,
          inv.issue_date,
          COUNT(DISTINCT il.id) AS affiliate_count
        FROM invoice_lines il
        JOIN invoices inv    ON il.invoice_id = inv.id AND inv.deleted_at IS NULL
        JOIN contracts c     ON inv.contract_id = c.id AND c.deleted_at IS NULL
        JOIN plans p         ON il.plan_id = p.id AND p.deleted_at IS NULL
        LEFT JOIN portfolios pf ON c.portfolio_id = pf.id AND pf.deleted_at IS NULL
        JOIN (
          SELECT invoice_id, MAX(payment_date) AS payment_date
          FROM payments
          WHERE status = 'COMPLETED' AND deleted_at IS NULL
          GROUP BY invoice_id
        ) pay ON pay.invoice_id = inv.id
        WHERE inv.billing_month = $1
          AND c.status = 'ACTIVE'
          AND il.category = 'MENSUALIDAD'
          AND il.deleted_at IS NULL
        GROUP BY p.name, p.amount, p.commission_amount, pf.code,
                 c.code, c.affiliation_date, pay.payment_date, inv.due_date, inv.issue_date
        `,
        [billingMonth],
      );
    } catch (err) {
      this.logger.error('Error querying invoice lines for SIP commissions:', err);
      throw new InternalServerErrorException(
        'Error al obtener los datos de facturación para el reporte de comisiones.',
      );
    }

    // Collect all unique portfolio codes from rawData
    const foundCodes = new Set<string>();
    for (const row of rawData) {
      foundCodes.add(row.portfolio_code);
    }
    const extraCodes = Array.from(foundCodes).filter(
      (code) => !activePortfolioCodes.includes(code),
    );
    extraCodes.sort();
    const portfolioCodes = [...activePortfolioCodes, ...extraCodes];

    // 4. Classify each record into a section
    const convenioRe = new RegExp(convenioInicialPattern);
    const sectionBuckets = this.classifyRowsIntoBuckets(rawData, convenioRe);

    // 5. Aggregate each bucket into sections
    const sectionDefs: Array<{ key: string; title: string }> = [
      { key: 'nuevos', title: 'AFILIACIONES NUEVOS CONTRATOS' },
      { key: 'cobranzasNuevoConvenio', title: 'COBRANZAS EJECUTADAS (SEGÚN NUEVO CONVENIO)' },
      {
        key: 'cobranzasConvenioInicial',
        title: 'COBRANZAS EJECUTADAS: CONVENIO INICIAL DESDE 002-001 HASTA 002-060',
      },
      {
        key: 'extemporaneosNuevoConvenio',
        title: 'COBRANZAS EJECUTADA CON EXTEMPORANEIDAD (SEGÚN NUEVO CONVENIO)',
      },
      { key: 'extemporaneosConvenioInicial', title: 'COBRANZAS EJECUTADA CON EXTEMPORANEIDAD' },
    ];

    const sections: ReportSection[] = [];
    for (const def of sectionDefs) {
      const bucket = sectionBuckets[def.key];
      const section = this.aggregateSection(def.title, bucket, portfolioCodes);
      sections.push(section);
    }

    const grandTotalCommission = sections.reduce((sum, s) => sum + s.subtotalCommission, 0);

    return { startDate, endDate, sections, grandTotalCommission, portfolioCodes };
  }

  /**
   * Helper to classify rows into section buckets.
   */
  private classifyRowsIntoBuckets(
    rawData: SipCommissionQueryRow[],
    convenioRe: RegExp,
  ): Record<string, SipCommissionQueryRow[]> {
    const buckets: Record<string, SipCommissionQueryRow[]> = {
      nuevos: [],
      cobranzasNuevoConvenio: [],
      cobranzasConvenioInicial: [],
      extemporaneosNuevoConvenio: [],
      extemporaneosConvenioInicial: [],
    };

    for (const row of rawData) {
      const isConvenioInicial = convenioRe.test(row.contract_code);
      const isNew = this.checkIsNew(row);
      const isExtemporaneo = this.checkIsExtemporaneo(row);

      if (isNew) {
        buckets.nuevos.push(row);
      } else if (isExtemporaneo) {
        if (isConvenioInicial) {
          buckets.extemporaneosConvenioInicial.push(row);
        } else {
          buckets.extemporaneosNuevoConvenio.push(row);
        }
      } else {
        if (isConvenioInicial) {
          buckets.cobranzasConvenioInicial.push(row);
        } else {
          buckets.cobranzasNuevoConvenio.push(row);
        }
      }
    }

    return buckets;
  }

  private checkIsNew(row: SipCommissionQueryRow): boolean {
    const affiliationDateStr = this.formatToDateString(row.affiliation_date);
    const issueDateStr = this.formatToDateString(row.issue_date);
    const nextIssueDateStr = formatToISODateString(
      getCaracasDateTime(row.issue_date).plus({ months: 1 }),
    );

    return affiliationDateStr >= issueDateStr && affiliationDateStr < nextIssueDateStr;
  }

  private checkIsExtemporaneo(row: SipCommissionQueryRow): boolean {
    const paymentDateStr = this.formatToDateString(row.payment_date);
    const dueDateStr = this.formatToDateString(row.due_date);

    return paymentDateStr > dueDateStr;
  }

  private formatToDateString(dateVal: Date | string): string {
    return formatToISODateString(dateVal);
  }

  /**
   * Aggregate raw rows into a report section, grouped by (planName + planAmount).
   */
  private aggregateSection(
    title: string,
    rows: SipCommissionQueryRow[],
    portfolioCodes: string[],
  ): ReportSection {
    // Group by plan_name + plan_amount key
    const grouped = new Map<
      string,
      {
        planName: string;
        planAmount: number;
        commissionAmount: number;
        affiliatesByPortfolio: Record<string, number>;
      }
    >();

    for (const row of rows) {
      const key = `${row.plan_name}|${Number(row.plan_amount).toFixed(2)}`;
      let group = grouped.get(key);
      if (!group) {
        group = {
          planName: row.plan_name,
          planAmount: Number(row.plan_amount),
          commissionAmount: Number(row.commission_amount),
          affiliatesByPortfolio: {},
        };
        grouped.set(key, group);
      }
      const code = row.portfolio_code;
      group.affiliatesByPortfolio[code] =
        (group.affiliatesByPortfolio[code] || 0) + Number(row.affiliate_count);
    }

    // Build final rows
    const commissionRows: CommissionRow[] = [];
    for (const group of grouped.values()) {
      const totalAffiliates = Object.values(group.affiliatesByPortfolio).reduce((s, v) => s + v, 0);
      commissionRows.push({
        planName: group.planName,
        planAmount: group.planAmount,
        commissionAmount: group.commissionAmount,
        affiliatesByPortfolio: group.affiliatesByPortfolio,
        totalAffiliates,
        totalCommission: group.commissionAmount * totalAffiliates,
      });
    }

    // Sort by plan name then amount
    commissionRows.sort(
      (a, b) => a.planName.localeCompare(b.planName) || a.planAmount - b.planAmount,
    );

    // Subtotals
    const subtotalAffiliatesByPortfolio: Record<string, number> = {};
    for (const code of portfolioCodes) {
      subtotalAffiliatesByPortfolio[code] = commissionRows.reduce(
        (s, r) => s + (r.affiliatesByPortfolio[code] || 0),
        0,
      );
    }
    const subtotalAffiliates = commissionRows.reduce((s, r) => s + r.totalAffiliates, 0);
    const subtotalCommission = commissionRows.reduce((s, r) => s + r.totalCommission, 0);

    return {
      title,
      rows: commissionRows,
      subtotalAffiliatesByPortfolio,
      subtotalAffiliates,
      subtotalCommission,
    };
  }

  /**
   * Generate the formatted Excel workbook buffer.
   */
  async generateExcel(year: number, month: number): Promise<Buffer> {
    const report = await this.buildReportData(year, month);
    const { workbook, ws } = createWorkbook('CUADRO DE COMISIONES MES');

    // Determine portfolio columns dynamically
    const portfolioCodes = report.portfolioCodes;
    // Columns: Plan | Importe Mensual | Comisión x Afiliado | ...portfolio cols... | Total Afiliac. | Comisión Total
    const totalCols = 3 + portfolioCodes.length + 2;

    // Set column widths
    const colWidths = [
      35, // A: Plan
      18, // B: Importe Mensual
      20, // C: Comisión x Afiliado
      ...portfolioCodes.map(() => 12), // Portfolio columns
      16, // Total Afiliac.
      18, // Comisión Total
    ];
    ws.columns = colWidths.map((w) => ({ width: w }));

    // Load logo
    const logoPath = await loadLogoImagePath(this.logger);
    this.renderLogo(workbook, ws, logoPath);

    // Empty rows for logo space
    let currentRow = 4;

    // Render Title & Subtitle Headers
    currentRow = this.renderExcelHeaders(ws, report, totalCols, currentRow);

    // === SECTIONS ===
    for (const section of report.sections) {
      if (section.rows.length === 0) continue; // Skip empty sections

      currentRow = this.writeSection(ws, section, portfolioCodes, totalCols, currentRow);
      currentRow += 2; // spacing between sections
    }

    // === GRAND TOTAL ===
    currentRow++;
    currentRow = this.renderExcelGrandTotal(ws, totalCols, report.grandTotalCommission, currentRow);

    // === FOOTER ===
    currentRow += 3;
    const footerRow = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, totalCols);
    const footerCell = footerRow.getCell(1);
    footerCell.value = 'P/Administración SIRCA';
    footerCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: BRAND.lightText } };
    footerCell.alignment = { horizontal: 'center' };

    // Generate buffer
    return finishWorkbook(workbook);
  }

  /**
   * Helper to load and render the logo in Excel.
   */
  private renderLogo(
    workbook: ExcelJS.Workbook,
    ws: ExcelJS.Worksheet,
    logoPath: string | null,
  ): void {
    if (!logoPath) return;
    const logoId = workbook.addImage({ filename: logoPath, extension: 'png' });
    ws.addImage(logoId, {
      tl: { col: 0, row: 0 },
      ext: { width: 180, height: 60 },
    });
  }

  /**
   * Helper to render Title/Subtitle Excel headers.
   */
  private renderExcelHeaders(
    ws: ExcelJS.Worksheet,
    report: SipCommissionReport,
    totalCols: number,
    startRow: number,
  ): number {
    let currentRow = startRow;

    // Title: RESUMEN MENSUAL
    const titleRow = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, totalCols);
    const titleCell = titleRow.getCell(1);
    titleCell.value = 'RESUMEN MENSUAL DE COMISIONES SIP';
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: BRAND.primaryGreen } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.height = 30;
    currentRow++;

    // Subtitle: Company name
    const companyRow = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, totalCols);
    const companyCell = companyRow.getCell(1);
    companyCell.value = 'Salud Integral El Rosario C.A.';
    companyCell.font = { name: 'Calibri', size: 11, color: { argb: BRAND.mediumText } };
    companyCell.alignment = { horizontal: 'center', vertical: 'middle' };
    currentRow++;

    // Corte dates
    const corteRow = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, totalCols);
    const corteCell = corteRow.getCell(1);
    corteCell.value = `Corte: Del ${formatDateES(report.startDate)} Al ${formatDateES(report.endDate)}`;
    corteCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.darkText } };
    corteCell.alignment = { horizontal: 'center', vertical: 'middle' };
    currentRow += 2; // extra blank row

    return currentRow;
  }

  /**
   * Helper to render Excel grand total row.
   */
  private renderExcelGrandTotal(
    ws: ExcelJS.Worksheet,
    totalCols: number,
    grandTotalCommission: number,
    currentRow: number,
  ): number {
    const grandRow = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, totalCols - 1);
    const grandLabelCell = grandRow.getCell(1);
    grandLabelCell.value = 'TOTAL MONTO A PAGAR POR COMISIONES AL CORTE';
    applyGrandTotalStyle(grandLabelCell, 'right');
    grandLabelCell.font = { ...grandLabelCell.font, size: 13 };

    const grandValueCell = grandRow.getCell(totalCols);
    grandValueCell.value = grandTotalCommission;
    grandValueCell.numFmt = '$#,##0.00';
    applyGrandTotalStyle(grandValueCell, 'center');
    grandValueCell.font = { ...grandValueCell.font, size: 13 };
    grandRow.height = 28;

    // Apply border to grand total
    for (let c = 1; c <= totalCols; c++) {
      grandRow.getCell(c).border = this.thinBorder();
    }

    return currentRow;
  }

  /**
   * Write a single section to the worksheet. Returns the next available row.
   */
  private writeSection(
    ws: ExcelJS.Worksheet,
    section: ReportSection,
    portfolioCodes: string[],
    totalCols: number,
    startRow: number,
  ): number {
    let currentRow = startRow;

    // Section title
    const titleRow = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, totalCols);
    const titleCell = titleRow.getCell(1);
    titleCell.value = section.title;
    titleCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: BRAND.white } };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: BRAND.primaryGreen },
    };
    titleRow.height = 24;
    currentRow++;

    // Column headers row 1: categories
    const catRow = ws.getRow(currentRow);
    catRow.getCell(1).value = '';
    catRow.getCell(2).value = '';
    catRow.getCell(3).value = '';

    // Merge portfolio columns under "AFILIADOS X CARTERA"
    if (portfolioCodes.length > 0) {
      const pfStart = 4;
      const pfEnd = 3 + portfolioCodes.length;
      ws.mergeCells(currentRow, pfStart, currentRow, pfEnd);
      const pfCell = catRow.getCell(pfStart);
      pfCell.value = 'AFILIADOS X CARTERA';
      pfCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: BRAND.darkText } };
      pfCell.alignment = { horizontal: 'center', vertical: 'middle' };
      pfCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: BRAND.altBackground },
      };
    }

    // Apply style to all header cells
    for (let c = 1; c <= totalCols; c++) {
      const cell = catRow.getCell(c);
      cell.border = this.thinBorder();
      if (!cell.fill || (cell.fill as ExcelJS.FillPattern).pattern !== 'solid') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: BRAND.altBackground },
        };
      }
    }
    currentRow++;

    // Column headers row 2: actual column names
    const headerRow = ws.getRow(currentRow);
    const headers = [
      'PLANES DE SALUD',
      'IMPORTE MENSUAL',
      'COMISIÓN X AFILIADO',
      ...portfolioCodes,
      'TOTAL AFILIAC.',
      'COMISIÓN TOTAL',
    ];
    headers.forEach((header, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = header;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.white } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: BRAND.primaryGreen },
      };
      cell.border = this.thinBorder();
    });
    headerRow.height = 22;
    currentRow++;

    // Data rows
    section.rows.forEach((row, idx) => {
      const dataRow = ws.getRow(currentRow);
      const isAlt = idx % 2 === 1;

      const cells: Array<{ value: string | number; numFmt?: string }> = [
        { value: row.planName },
        { value: row.planAmount, numFmt: '$#,##0.00' },
        { value: row.commissionAmount, numFmt: '$#,##0.00' },
        ...portfolioCodes.map((code) => ({
          value: row.affiliatesByPortfolio[code] || 0,
        })),
        { value: row.totalAffiliates },
        { value: row.totalCommission, numFmt: '$#,##0.00' },
      ];

      cells.forEach((cellData, i) => {
        const cell = dataRow.getCell(i + 1);
        cell.value = cellData.value;
        if (cellData.numFmt) cell.numFmt = cellData.numFmt;
        cell.font = { name: 'Calibri', size: 10, color: { argb: BRAND.darkText } };
        cell.alignment = {
          horizontal: i === 0 ? 'left' : 'center',
          vertical: 'middle',
        };
        cell.border = this.thinBorder();
        if (isAlt) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: BRAND.altBackground },
          };
        }
      });
      currentRow++;
    });

    // Subtotal row
    const subtotalRow = ws.getRow(currentRow);
    const subtotalCells: Array<{ value: string | number; numFmt?: string }> = [
      { value: '' },
      { value: '' },
      { value: '' },
      ...portfolioCodes.map((code) => ({
        value: section.subtotalAffiliatesByPortfolio[code] || 0,
      })),
      { value: section.subtotalAffiliates },
      { value: section.subtotalCommission, numFmt: '$#,##0.00' },
    ];

    subtotalCells.forEach((cellData, i) => {
      const cell = subtotalRow.getCell(i + 1);
      cell.value = cellData.value;
      if (cellData.numFmt) cell.numFmt = cellData.numFmt;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.darkText } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = this.thinBorder();
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'e8f5e9' }, // Light green background
      };
    });
    currentRow++;

    // "MONTO TOTAL POR COMISIONES A PAGAR" row
    const totalLabelRow = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, totalCols - 1);
    const totalLabelCell = totalLabelRow.getCell(1);
    totalLabelCell.value = 'MONTO TOTAL POR COMISIONES A PAGAR';
    totalLabelCell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: BRAND.primaryGreen },
    };
    totalLabelCell.alignment = { horizontal: 'right', vertical: 'middle' };
    totalLabelCell.border = this.thinBorder();

    const totalValueCell = totalLabelRow.getCell(totalCols);
    totalValueCell.value = section.subtotalCommission;
    totalValueCell.numFmt = '$#,##0.00';
    totalValueCell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: BRAND.primaryGreen },
    };
    totalValueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    totalValueCell.border = this.thinBorder();
    totalLabelRow.height = 22;
    currentRow++;

    return currentRow;
  }

  /** Helper: Create a thin border style (delegates to shared utility) */
  private thinBorder(): Partial<ExcelJS.Borders> {
    return thinBorder();
  }

  /**
   * Generate the formatted PDF report buffer.
   */
  async generatePdf(year: number, month: number): Promise<Buffer> {
    const report = await this.buildReportData(year, month);

    const generatedAt = getGeneratedAtTimestamp();
    const logoBase64 = await loadLogoBase64(this.logger);

    // Format fields for handlebars rendering
    const formattedSections = report.sections.map((section) => ({
      title: section.title,
      rows: section.rows.map((row) => ({
        planName: row.planName,
        planAmountFormatted: Number(row.planAmount).toFixed(2),
        commissionAmountFormatted: Number(row.commissionAmount).toFixed(2),
        affiliatesByPortfolio: report.portfolioCodes.reduce(
          (acc, code) => {
            acc[code] = row.affiliatesByPortfolio[code] || 0;
            return acc;
          },
          {} as Record<string, number>,
        ),
        totalAffiliates: row.totalAffiliates,
        totalCommissionFormatted: Number(row.totalCommission).toFixed(2),
      })),
      subtotalAffiliatesByPortfolio: section.subtotalAffiliatesByPortfolio,
      subtotalAffiliates: section.subtotalAffiliates,
      subtotalCommissionFormatted: Number(section.subtotalCommission).toFixed(2),
    }));

    const templateData = {
      logo: logoBase64,
      generatedAt,
      startDateES: formatDateES(report.startDate),
      endDateES: formatDateES(report.endDate),
      sections: formattedSections,
      portfolioCodes: report.portfolioCodes,
      colspan: 4 + report.portfolioCodes.length,
      grandTotalCommissionFormatted: Number(report.grandTotalCommission).toFixed(2),
    };

    return this.pdfService.generatePdf('sip-commissions', templateData, { landscape: true });
  }
}
