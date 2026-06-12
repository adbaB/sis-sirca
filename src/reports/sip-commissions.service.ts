import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs/promises';
import { DateTime } from 'luxon';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { PdfService } from '../pdf/services/pdf.service';

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

// Brand colors from SIRCA's design system
const BRAND = {
  primaryGreen: '1d9e11',
  darkText: '333333',
  mediumText: '666666',
  lightText: '999999',
  border: 'e2e8f0',
  altBackground: 'f8fafc',
  white: 'FFFFFF',
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
  async buildReportData(startDate: string, endDate: string): Promise<SipCommissionReport> {
    // 1. Get all active portfolio codes for column headers
    const portfolios = await this.dataSource.query(
      `SELECT code FROM portfolios WHERE status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code`,
    );
    const activePortfolioCodes: string[] = portfolios.map((p: { code: string }) => p.code);

    // 2. Determine which contract codes are "convenio inicial" (SIR-002-001 to SIR-002-060)
    const convenioInicialPattern = `^SIR-002-0[0-5][0-9]$|^SIR-002-060$`;

    // 3. Fetch all invoice details with related data for the period
    const rawData = await this.dataSource.query(
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
        COUNT(DISTINCT id_detail.id) AS affiliate_count
      FROM invoice_details id_detail
      JOIN invoices inv    ON id_detail.invoice_id = inv.id AND inv.deleted_at IS NULL
      JOIN contracts c     ON inv.contract_id = c.id        AND c.deleted_at IS NULL
      JOIN plans p         ON id_detail.plan_id = p.id
      LEFT JOIN portfolios pf ON c.portfolio_id = pf.id
      JOIN (
        SELECT invoice_id, MAX(payment_date) AS payment_date
        FROM payments
        WHERE status = 'COMPLETED' AND deleted_at IS NULL
        GROUP BY invoice_id
      ) pay ON pay.invoice_id = inv.id
      WHERE pay.payment_date >= $1
        AND pay.payment_date < ($2::date + interval '1 day')
        AND c.status = 'ACTIVE'
        AND id_detail.deleted_at IS NULL
      GROUP BY p.name, p.amount, p.commission_amount, pf.code,
               c.code, c.affiliation_date, pay.payment_date, inv.due_date
      `,
      [startDate, endDate],
    );

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
    const sectionBuckets: Record<string, Array<(typeof rawData)[0]>> = {
      nuevos: [],
      cobranzasNuevoConvenio: [],
      cobranzasConvenioInicial: [],
      extemporaneosNuevoConvenio: [],
      extemporaneosConvenioInicial: [],
    };

    const convenioRe = new RegExp(convenioInicialPattern);
    const toDateString = (dateVal: Date | string) => {
      if (!dateVal) return '';
      const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
      return d.toISOString().slice(0, 10);
    };

    for (const row of rawData) {
      const affiliationDateStr = toDateString(row.affiliation_date);
      const paymentDateStr = DateTime.fromJSDate(
        row.payment_date instanceof Date ? row.payment_date : new Date(row.payment_date),
      )
        .setZone('America/Caracas')
        .toFormat('yyyy-MM-dd');
      const dueDateStr = toDateString(row.due_date);

      const isConvenioInicial = convenioRe.test(row.contract_code);
      const isNew = affiliationDateStr >= startDate && affiliationDateStr <= endDate;
      const isExtemporaneo = paymentDateStr > dueDateStr;

      if (isNew) {
        sectionBuckets.nuevos.push(row);
      } else if (isExtemporaneo) {
        if (isConvenioInicial) {
          sectionBuckets.extemporaneosConvenioInicial.push(row);
        } else {
          sectionBuckets.extemporaneosNuevoConvenio.push(row);
        }
      } else {
        if (isConvenioInicial) {
          sectionBuckets.cobranzasConvenioInicial.push(row);
        } else {
          sectionBuckets.cobranzasNuevoConvenio.push(row);
        }
      }
    }

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
   * Aggregate raw rows into a report section, grouped by (planName + planAmount).
   */
  private aggregateSection(
    title: string,
    rows: Array<{
      plan_name: string;
      plan_amount: string;
      commission_amount: string;
      portfolio_code: string;
      affiliate_count: string;
    }>,
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
      if (!grouped.has(key)) {
        grouped.set(key, {
          planName: row.plan_name,
          planAmount: Number(row.plan_amount),
          commissionAmount: Number(row.commission_amount),
          affiliatesByPortfolio: {},
        });
      }
      const group = grouped.get(key)!;
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
  async generateExcel(startDate: string, endDate: string): Promise<Buffer> {
    const report = await this.buildReportData(startDate, endDate);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SIRCA - Sistema Integral';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('CUADRO DE COMISIONES MES', {
      properties: { defaultColWidth: 15 },
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });

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
    let logoId: number | null = null;
    try {
      const logoPath = path.join(process.cwd(), 'src', 'assets', 'images', 'logo.png');
      await fs.access(logoPath);
      logoId = workbook.addImage({ filename: logoPath, extension: 'png' });
    } catch {
      try {
        const logoPath = path.join(process.cwd(), 'dist', 'assets', 'images', 'logo.png');
        await fs.access(logoPath);
        logoId = workbook.addImage({ filename: logoPath, extension: 'png' });
      } catch {
        this.logger.warn('Logo not found, skipping logo in report');
      }
    }

    // === HEADER SECTION ===
    if (logoId !== null) {
      ws.addImage(logoId, {
        tl: { col: 0, row: 0 },
        ext: { width: 180, height: 60 },
      });
    }

    // Empty rows for logo space
    let currentRow = 4;

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
    corteCell.value = `Corte: Del ${this.formatDateES(report.startDate)} Al ${this.formatDateES(report.endDate)}`;
    corteCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.darkText } };
    corteCell.alignment = { horizontal: 'center', vertical: 'middle' };
    currentRow += 2; // extra blank row

    // === SECTIONS ===
    for (const section of report.sections) {
      if (section.rows.length === 0) continue; // Skip empty sections

      currentRow = this.writeSection(ws, section, portfolioCodes, totalCols, currentRow);
      currentRow += 2; // spacing between sections
    }

    // === GRAND TOTAL ===
    currentRow++;
    const grandRow = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, totalCols - 1);
    const grandLabelCell = grandRow.getCell(1);
    grandLabelCell.value = 'TOTAL MONTO A PAGAR POR COMISIONES AL CORTE';
    grandLabelCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: BRAND.white } };
    grandLabelCell.alignment = { horizontal: 'right', vertical: 'middle' };
    grandLabelCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: BRAND.primaryGreen },
    };

    const grandValueCell = grandRow.getCell(totalCols);
    grandValueCell.value = report.grandTotalCommission;
    grandValueCell.numFmt = '$#,##0.00';
    grandValueCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: BRAND.white } };
    grandValueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    grandValueCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: BRAND.primaryGreen },
    };
    grandRow.height = 28;

    // Apply border to grand total
    for (let c = 1; c <= totalCols; c++) {
      grandRow.getCell(c).border = this.thinBorder();
    }

    // === FOOTER ===
    currentRow += 3;
    const footerRow = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, totalCols);
    const footerCell = footerRow.getCell(1);
    footerCell.value = 'P/Administración SIRCA';
    footerCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: BRAND.lightText } };
    footerCell.alignment = { horizontal: 'center' };

    // Generate buffer
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
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

  /** Helper: Create a thin border style */
  private thinBorder(): Partial<ExcelJS.Borders> {
    const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: BRAND.border } };
    return { top: side, left: side, bottom: side, right: side };
  }

  /** Helper: Format a date string as DD-MM-YYYY */
  private formatDateES(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }

  /**
   * Generate the formatted PDF report buffer.
   */
  async generatePdf(startDate: string, endDate: string): Promise<Buffer> {
    const report = await this.buildReportData(startDate, endDate);

    const generatedAt = new Date().toLocaleString('es-VE', {
      timeZone: 'America/Caracas',
    });

    let logoBase64 = '';
    try {
      const logoPath = path.join(process.cwd(), 'src', 'assets', 'images', 'logo.png');
      const logoBuffer = await fs.readFile(logoPath);
      logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
    } catch {
      try {
        const logoPath = path.join(process.cwd(), 'dist', 'assets', 'images', 'logo.png');
        const logoBuffer = await fs.readFile(logoPath);
        logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
      } catch (err2) {
        this.logger.error('Could not load logo image for PDF:', err2);
      }
    }

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
      startDateES: this.formatDateES(report.startDate),
      endDateES: this.formatDateES(report.endDate),
      sections: formattedSections,
      portfolioCodes: report.portfolioCodes,
      colspan: 4 + report.portfolioCodes.length,
      grandTotalCommissionFormatted: Number(report.grandTotalCommission).toFixed(2),
    };

    return this.pdfService.generatePdf('sip-commissions', templateData, { landscape: true });
  }
}
