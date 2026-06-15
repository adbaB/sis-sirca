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
  MONTH_NAMES_ES,
} from './report-utils';

interface AdvisorPaymentQueryRow {
  payment_date: string | Date;
  reference_number: string;
  payment_method: string;
  payment_amount: number | string;
  payment_amount_bs: number | string;
  contract_code: string;
  invoice_status: string;
  portfolio_code: string;
  surplus_amount: number | string;
  surplus_amount_bs: number | string;
  type_identity_card: string | null;
  identity_card: string | null;
  titular_name: string | null;
}

interface AdvisorPaymentRow {
  paymentDate: string;
  paymentDateES: string;
  referenceNumber: string;
  paymentMethod: string;
  paymentAmount: number;
  paymentAmountFormatted: string;
  paymentAmountBs: number;
  paymentAmountBsFormatted: string;
  contractCode: string;
  invoiceStatus: string;
  invoiceStatusLabel: string;
  surplusAmount: number;
  surplusAmountFormatted: string;
  surplusAmountBs: number;
  surplusAmountBsFormatted: string;
  titularCard: string;
  titularName: string;
}

interface PortfolioSection {
  portfolioCode: string;
  payments: AdvisorPaymentRow[];
  subtotalSurplus: number;
  subtotalSurplusFormatted: string;
  subtotalSurplusBs: number;
  subtotalSurplusBsFormatted: string;
  subtotalBs: number;
  subtotalBsFormatted: string;
  subtotalUsd: number;
  subtotalUsdFormatted: string;
}

interface AdvisorPaymentsReport {
  advisorName: string;
  billingMonthLabel: string;
  sections: PortfolioSection[];
  grandTotalSurplus: number;
  grandTotalSurplusFormatted: string;
  grandTotalSurplusBs: number;
  grandTotalSurplusBsFormatted: string;
  grandTotalBs: number;
  grandTotalBsFormatted: string;
  grandTotalUsd: number;
  grandTotalUsdFormatted: string;
}

// Use shared constants from report-utils
const BRAND = BRAND_COLORS;

@Injectable()
export class AdvisorPaymentsService {
  private readonly logger = new Logger(AdvisorPaymentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Build the complete advisor payments report data from the database.
   */
  async buildReportData(
    year: number,
    month: number,
    advisorId?: string,
  ): Promise<AdvisorPaymentsReport> {
    const monthStr = String(month).padStart(2, '0');
    const billingMonth = `${year}-${monthStr}`;
    const billingMonthLabel = `${MONTH_NAMES_ES[month - 1]} ${year}`;

    // 1. Fetch advisor name if provided
    let advisorName: string;
    try {
      advisorName = await fetchAdvisorName(this.dataSource, advisorId);
    } catch (err) {
      this.logger.error('Error fetching advisor name:', err);
      throw new InternalServerErrorException('Error al obtener el nombre del asesor.');
    }

    // 2. Fetch completed payments for this billing month
    let sql = `
      SELECT
        pay.id AS payment_id,
        pay.payment_date,
        pay.reference_number,
        pay.payment_method,
        pay.amount AS payment_amount,
        pay.amount_bs AS payment_amount_bs,
        c.code AS contract_code,
        inv.status AS invoice_status,
        COALESCE(pf.code, 'SIN_CARTERA') AS portfolio_code,
        COALESCE(
          (SELECT SUM(amount_usd)
           FROM surpluses s
           WHERE s.payment_id = pay.id AND s.status != 'cancelled'),
          0
        ) AS surplus_amount,
        COALESCE(
          (SELECT SUM(amount_bs)
           FROM surpluses s
           WHERE s.payment_id = pay.id AND s.status != 'cancelled'),
          0
        ) AS surplus_amount_bs,
        pers.type_identity_card,
        pers.identity_card,
        pers.name AS titular_name
      FROM payments pay
      JOIN invoices inv ON pay.invoice_id = inv.id AND inv.deleted_at IS NULL
      JOIN contracts c ON inv.contract_id = c.id AND c.deleted_at IS NULL
      LEFT JOIN portfolios pf ON c.portfolio_id = pf.id
      LEFT JOIN contract_persons cp ON cp.contract_id = c.id AND cp.is_billing_owner = true AND cp.deleted_at IS NULL
      LEFT JOIN persons pers ON cp.person_id = pers.id
      WHERE inv.billing_month = $1
        AND pay.status = 'COMPLETED'
        AND pay.deleted_at IS NULL
    `;

    const params: string[] = [billingMonth];
    if (advisorId) {
      sql += ` AND c.advisor_id = $2`;
      params.push(advisorId);
    }

    sql += ` ORDER BY COALESCE(pf.code, 'SIN_CARTERA') ASC, pay.payment_date ASC, c.code ASC`;

    let rawData: AdvisorPaymentQueryRow[];
    try {
      rawData = await this.dataSource.query(sql, params);
    } catch (err) {
      this.logger.error('Error querying advisor payments:', err);
      throw new InternalServerErrorException(
        'Error al obtener los datos de pagos para el reporte.',
      );
    }

    // 3. Group by portfolio code
    const portfolioGroups = new Map<string, AdvisorPaymentRow[]>();

    for (const row of rawData) {
      const portfolioCode = row.portfolio_code;
      if (!portfolioGroups.has(portfolioCode)) {
        portfolioGroups.set(portfolioCode, []);
      }

      const pDate = new Date(row.payment_date);
      const paymentDateES = formatDateES(pDate);

      const invoiceStatusLabel =
        row.invoice_status === 'PAID'
          ? 'PAGADA'
          : row.invoice_status === 'PARTIAL'
            ? 'PARCIAL'
            : row.invoice_status;

      const titularCard = row.type_identity_card
        ? `${row.type_identity_card}-${row.identity_card}`
        : 'Sin titular';

      portfolioGroups.get(portfolioCode)!.push({
        paymentDate: String(row.payment_date),
        paymentDateES,
        referenceNumber: row.reference_number,
        paymentMethod: row.payment_method,
        paymentAmount: Number(row.payment_amount || 0),
        paymentAmountFormatted: Number(row.payment_amount || 0).toFixed(2),
        paymentAmountBs: Number(row.payment_amount_bs || 0),
        paymentAmountBsFormatted: Number(row.payment_amount_bs || 0).toFixed(2),
        contractCode: row.contract_code,
        invoiceStatus: row.invoice_status,
        invoiceStatusLabel,
        surplusAmount: Number(row.surplus_amount || 0),
        surplusAmountFormatted: Number(row.surplus_amount || 0).toFixed(2),
        surplusAmountBs: Number(row.surplus_amount_bs || 0),
        surplusAmountBsFormatted: Number(row.surplus_amount_bs || 0).toFixed(2),
        titularCard,
        titularName: row.titular_name || 'Sin titular',
      });
    }

    // 4. Calculate subtotals and grand totals
    const sections: PortfolioSection[] = [];
    let grandTotalSurplus = 0;
    let grandTotalSurplusBs = 0;
    let grandTotalBs = 0;
    let grandTotalUsd = 0;

    for (const [portfolioCode, payments] of portfolioGroups.entries()) {
      const subtotalSurplus = payments.reduce((sum, r) => sum + r.surplusAmount, 0);
      const subtotalSurplusBs = payments.reduce((sum, r) => sum + r.surplusAmountBs, 0);
      const subtotalBs = payments.reduce((sum, r) => sum + r.paymentAmountBs, 0);
      const subtotalUsd = payments.reduce((sum, r) => sum + r.paymentAmount, 0);

      grandTotalSurplus += subtotalSurplus;
      grandTotalSurplusBs += subtotalSurplusBs;
      grandTotalBs += subtotalBs;
      grandTotalUsd += subtotalUsd;

      sections.push({
        portfolioCode,
        payments,
        subtotalSurplus,
        subtotalSurplusFormatted: subtotalSurplus.toFixed(2),
        subtotalSurplusBs,
        subtotalSurplusBsFormatted: subtotalSurplusBs.toFixed(2),
        subtotalBs,
        subtotalBsFormatted: subtotalBs.toFixed(2),
        subtotalUsd,
        subtotalUsdFormatted: subtotalUsd.toFixed(2),
      });
    }

    // Sort sections alphabetically by portfolioCode
    sections.sort((a, b) => a.portfolioCode.localeCompare(b.portfolioCode));

    return {
      advisorName,
      billingMonthLabel,
      sections,
      grandTotalSurplus,
      grandTotalSurplusFormatted: grandTotalSurplus.toFixed(2),
      grandTotalSurplusBs,
      grandTotalSurplusBsFormatted: grandTotalSurplusBs.toFixed(2),
      grandTotalBs,
      grandTotalBsFormatted: grandTotalBs.toFixed(2),
      grandTotalUsd,
      grandTotalUsdFormatted: grandTotalUsd.toFixed(2),
    };
  }

  /**
   * Generate the formatted Excel workbook buffer.
   */
  async generateExcel(year: number, month: number, advisorId?: string): Promise<Buffer> {
    const report = await this.buildReportData(year, month, advisorId);
    const { workbook, ws } = createWorkbook('RELACIÓN DE PAGOS');

    const totalCols = 10;

    // A. TITLE
    const titleRow = ws.addRow(['RELACIÓN DE PAGOS POR ASESOR']);
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
      color: { argb: 'FF' + BRAND.darkText },
    };
    advisorRow.getCell(1).alignment = { horizontal: 'left' };
    advisorRow.height = 20;

    const billingMonthRow = ws.addRow([`Mes de Facturación: ${report.billingMonthLabel}`]);
    ws.mergeCells(3, 1, 3, totalCols);
    billingMonthRow.getCell(1).font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FF' + BRAND.darkText },
    };
    billingMonthRow.getCell(1).alignment = { horizontal: 'left' };
    billingMonthRow.height = 20;

    ws.addRow([]); // Blank row

    let currentRowIdx = 5;

    // C. LOOP THROUGH SECTIONS
    for (const section of report.sections) {
      if (section.payments.length === 0) continue;

      // Section Header (Portfolio Title)
      const secHeaderRow = ws.addRow([`CARTERA: ${section.portfolioCode}`]);
      ws.mergeCells(currentRowIdx, 1, currentRowIdx, totalCols);
      applySectionHeaderStyle(secHeaderRow.getCell(1));
      secHeaderRow.height = 25;
      currentRowIdx++;

      // Table Headers
      const headers = [
        'CONTRATO',
        'TITULAR',
        'FECHA PAGO',
        'REFERENCIA',
        'MÉTODO',
        'ESTADO FACT.',
        'EXCEDENTE ($)',
        'EXCEDENTE (Bs.)',
        'MONTO BS.',
        'MONTO USD ($)',
      ];
      const headerRow = ws.addRow(headers);
      headerRow.height = 22;
      for (let c = 1; c <= totalCols; c++) {
        applyTableHeaderStyle(headerRow.getCell(c));
      }
      currentRowIdx++;

      // Table Body Rows
      for (const pay of section.payments) {
        const rowData = [
          pay.contractCode,
          `${pay.titularName} (${pay.titularCard})`,
          pay.paymentDateES,
          pay.referenceNumber,
          pay.paymentMethod,
          pay.invoiceStatusLabel,
          pay.surplusAmount,
          pay.surplusAmountBs,
          pay.paymentAmountBs,
          pay.paymentAmount,
        ];
        const row = ws.addRow(rowData);
        row.height = 20;

        // Alignment & Formatting
        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(2).alignment = { horizontal: 'left' };
        row.getCell(3).alignment = { horizontal: 'center' };
        row.getCell(4).alignment = { horizontal: 'center' };
        row.getCell(5).alignment = { horizontal: 'center' };
        row.getCell(6).alignment = { horizontal: 'center' };

        row.getCell(7).numFmt = '$#,##0.00';
        row.getCell(7).alignment = { horizontal: 'right' };
        row.getCell(8).numFmt = '"Bs. "#,##0.00';
        row.getCell(8).alignment = { horizontal: 'right' };
        row.getCell(9).numFmt = '"Bs. "#,##0.00';
        row.getCell(9).alignment = { horizontal: 'right' };
        row.getCell(10).numFmt = '$#,##0.00';
        row.getCell(10).alignment = { horizontal: 'right' };

        for (let c = 1; c <= totalCols; c++) {
          applyDataCellStyle(row.getCell(c));
        }
        currentRowIdx++;
      }

      // Subtotal Row
      const subtotalRow = ws.addRow([
        'Subtotales',
        '',
        '',
        '',
        '',
        '',
        section.subtotalSurplus,
        section.subtotalSurplusBs,
        section.subtotalBs,
        section.subtotalUsd,
      ]);
      ws.mergeCells(currentRowIdx, 1, currentRowIdx, 6);
      subtotalRow.height = 22;

      subtotalRow.getCell(1).font = { name: 'Calibri', size: 10, bold: true };
      subtotalRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

      subtotalRow.getCell(7).numFmt = '$#,##0.00';
      subtotalRow.getCell(7).font = { name: 'Calibri', size: 10, bold: true };
      subtotalRow.getCell(7).alignment = { horizontal: 'right', vertical: 'middle' };

      subtotalRow.getCell(8).numFmt = '"Bs. "#,##0.00';
      subtotalRow.getCell(8).font = { name: 'Calibri', size: 10, bold: true };
      subtotalRow.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };

      subtotalRow.getCell(9).numFmt = '"Bs. "#,##0.00';
      subtotalRow.getCell(9).font = { name: 'Calibri', size: 10, bold: true };
      subtotalRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };

      subtotalRow.getCell(10).numFmt = '$#,##0.00';
      subtotalRow.getCell(10).font = { name: 'Calibri', size: 10, bold: true };
      subtotalRow.getCell(10).alignment = { horizontal: 'right', vertical: 'middle' };

      for (let c = 1; c <= totalCols; c++) {
        const cell = subtotalRow.getCell(c);
        applySubtotalCellStyle(cell);
      }
      currentRowIdx++;

      ws.addRow([]); // Blank row
      currentRowIdx++;
    }

    // D. GRAND TOTALS
    const blankRowIdx = currentRowIdx;
    ws.addRow([]);

    const gtSurplusRow = ws.addRow([
      'MONTO TOTAL EXCEDENTES ($):',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      report.grandTotalSurplus,
    ]);
    ws.mergeCells(blankRowIdx + 1, 1, blankRowIdx + 1, 9);
    gtSurplusRow.height = 24;
    applyGrandTotalStyle(gtSurplusRow.getCell(1), 'right');
    gtSurplusRow.getCell(10).numFmt = '$#,##0.00';
    applyGrandTotalStyle(gtSurplusRow.getCell(10), 'center');

    const gtSurplusBsRow = ws.addRow([
      'MONTO TOTAL EXCEDENTES BS. (Bs.):',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      report.grandTotalSurplusBs,
    ]);
    ws.mergeCells(blankRowIdx + 2, 1, blankRowIdx + 2, 9);
    gtSurplusBsRow.height = 24;
    applyGrandTotalStyle(gtSurplusBsRow.getCell(1), 'right');
    gtSurplusBsRow.getCell(10).numFmt = '"Bs. "#,##0.00';
    applyGrandTotalStyle(gtSurplusBsRow.getCell(10), 'center');

    const gtBsRow = ws.addRow([
      'MONTO TOTAL PAGOS BS. (Bs.):',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      report.grandTotalBs,
    ]);
    ws.mergeCells(blankRowIdx + 3, 1, blankRowIdx + 3, 9);
    gtBsRow.height = 24;
    applyGrandTotalStyle(gtBsRow.getCell(1), 'right');
    gtBsRow.getCell(10).numFmt = '"Bs. "#,##0.00';
    applyGrandTotalStyle(gtBsRow.getCell(10), 'center');

    const gtUsdRow = ws.addRow([
      'MONTO TOTAL PAGOS USD ($):',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      report.grandTotalUsd,
    ]);
    ws.mergeCells(blankRowIdx + 4, 1, blankRowIdx + 4, 9);
    gtUsdRow.height = 24;
    applyGrandTotalStyle(gtUsdRow.getCell(1), 'right');
    gtUsdRow.getCell(10).numFmt = '$#,##0.00';
    applyGrandTotalStyle(gtUsdRow.getCell(10), 'center');

    // Set precise columns width
    ws.getColumn(1).width = 15; // Contract code
    ws.getColumn(2).width = 30; // Titular
    ws.getColumn(3).width = 15; // Payment Date
    ws.getColumn(4).width = 18; // Reference
    ws.getColumn(5).width = 18; // Method
    ws.getColumn(6).width = 15; // Status
    ws.getColumn(7).width = 18; // Surplus USD
    ws.getColumn(8).width = 18; // Surplus Bs
    ws.getColumn(9).width = 18; // Amount Bs
    ws.getColumn(10).width = 18; // Amount USD

    return finishWorkbook(workbook);
  }

  /**
   * Generate the formatted PDF report buffer.
   */
  async generatePdf(year: number, month: number, advisorId?: string): Promise<Buffer> {
    const report = await this.buildReportData(year, month, advisorId);

    const generatedAt = getGeneratedAtTimestamp();
    const logoBase64 = await loadLogoBase64(this.logger);

    const templateData = {
      logo: logoBase64 || null,
      generatedAt,
      advisorName: report.advisorName,
      billingMonthLabel: report.billingMonthLabel,
      sections: report.sections,
      grandTotalSurplusFormatted: report.grandTotalSurplusFormatted,
      grandTotalSurplusBsFormatted: report.grandTotalSurplusBsFormatted,
      grandTotalBsFormatted: report.grandTotalBsFormatted,
      grandTotalUsdFormatted: report.grandTotalUsdFormatted,
    };

    return this.pdfService.generatePdf('advisor-payments', templateData, { landscape: true });
  }
}
