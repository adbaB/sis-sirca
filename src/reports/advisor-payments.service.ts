import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs/promises';
import { DateTime } from 'luxon';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { PdfService } from '../pdf/services/pdf.service';

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
  titularCard: string;
  titularName: string;
}

interface PortfolioSection {
  portfolioCode: string;
  payments: AdvisorPaymentRow[];
  subtotalSurplus: number;
  subtotalSurplusFormatted: string;
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
  grandTotalBs: number;
  grandTotalBsFormatted: string;
  grandTotalUsd: number;
  grandTotalUsdFormatted: string;
}

// Brand colors from SIRCA's design system
const BRAND = {
  primaryGreen: '1d9e11',
  darkText: '333333',
  mediumText: '666666',
  lightGrayBg: 'f8fafc',
  borderColor: 'e2e8f0',
  subtotalGreen: 'e8f5e9',
};

const MONTH_NAMES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

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
    let advisorName = 'Todos los Asesores';
    if (advisorId) {
      const advisorRes = await this.dataSource.query(
        `SELECT name FROM advisors WHERE id = $1 AND deleted_at IS NULL`,
        [advisorId],
      );
      if (advisorRes && advisorRes.length > 0) {
        advisorName = advisorRes[0].name;
      } else {
        advisorName = 'Asesor No Encontrado';
      }
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

    const rawData = await this.dataSource.query(sql, params);

    // 3. Group by portfolio code
    const portfolioGroups = new Map<string, AdvisorPaymentRow[]>();

    for (const row of rawData) {
      const portfolioCode = row.portfolio_code;
      if (!portfolioGroups.has(portfolioCode)) {
        portfolioGroups.set(portfolioCode, []);
      }

      const pDate = new Date(row.payment_date);
      const paymentDateES = DateTime.fromJSDate(pDate)
        .setZone('America/Caracas')
        .toFormat('dd-MM-yyyy');

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
        paymentDate: row.payment_date,
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
        titularCard,
        titularName: row.titular_name || 'Sin titular',
      });
    }

    // 4. Calculate subtotals and grand totals
    const sections: PortfolioSection[] = [];
    let grandTotalSurplus = 0;
    let grandTotalBs = 0;
    let grandTotalUsd = 0;

    for (const [portfolioCode, payments] of portfolioGroups.entries()) {
      const subtotalSurplus = payments.reduce((sum, r) => sum + r.surplusAmount, 0);
      const subtotalBs = payments.reduce((sum, r) => sum + r.paymentAmountBs, 0);
      const subtotalUsd = payments.reduce((sum, r) => sum + r.paymentAmount, 0);

      grandTotalSurplus += subtotalSurplus;
      grandTotalBs += subtotalBs;
      grandTotalUsd += subtotalUsd;

      sections.push({
        portfolioCode,
        payments,
        subtotalSurplus,
        subtotalSurplusFormatted: subtotalSurplus.toFixed(2),
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
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SIRCA - Sistema Integral';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('RELACIÓN DE PAGOS', {
      properties: { defaultColWidth: 15 },
      pageSetup: { orientation: 'landscape', fitToPage: true },
    });

    const totalCols = 9;

    // A. TITLE
    const titleRow = ws.addRow(['RELACIÓN DE PAGOS POR ASESOR']);
    ws.mergeCells(1, 1, 1, totalCols);
    titleRow.getCell(1).font = {
      name: 'Calibri',
      size: 16,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF' + BRAND.primaryGreen },
    };
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
      secHeaderRow.getCell(1).font = {
        name: 'Calibri',
        size: 12,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      secHeaderRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF' + BRAND.primaryGreen },
      };
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
        'MONTO BS.',
        'MONTO USD ($)',
      ];
      const headerRow = ws.addRow(headers);
      headerRow.height = 22;
      for (let c = 1; c <= totalCols; c++) {
        const cell = headerRow.getCell(c);
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF334155' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF' + BRAND.borderColor } },
          bottom: { style: 'medium', color: { argb: 'FF' + BRAND.borderColor } },
          left: { style: 'thin', color: { argb: 'FF' + BRAND.borderColor } },
          right: { style: 'thin', color: { argb: 'FF' + BRAND.borderColor } },
        };
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
        row.getCell(9).numFmt = '$#,##0.00';
        row.getCell(9).alignment = { horizontal: 'right' };

        for (let c = 1; c <= totalCols; c++) {
          row.getCell(c).border = {
            top: { style: 'thin', color: { argb: 'FF' + BRAND.borderColor } },
            bottom: { style: 'thin', color: { argb: 'FF' + BRAND.borderColor } },
            left: { style: 'thin', color: { argb: 'FF' + BRAND.borderColor } },
            right: { style: 'thin', color: { argb: 'FF' + BRAND.borderColor } },
          };
          row.getCell(c).font = { name: 'Calibri', size: 10 };
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

      subtotalRow.getCell(9).numFmt = '$#,##0.00';
      subtotalRow.getCell(9).font = { name: 'Calibri', size: 10, bold: true };
      subtotalRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };

      for (let c = 1; c <= totalCols; c++) {
        const cell = subtotalRow.getCell(c);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF' + BRAND.subtotalGreen },
        };
        cell.border = {
          top: { style: 'medium', color: { argb: 'FF' + BRAND.borderColor } },
          bottom: { style: 'double', color: { argb: 'FF' + BRAND.borderColor } },
          left: { style: 'thin', color: { argb: 'FF' + BRAND.borderColor } },
          right: { style: 'thin', color: { argb: 'FF' + BRAND.borderColor } },
        };
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
      report.grandTotalSurplus,
    ]);
    ws.mergeCells(blankRowIdx + 1, 1, blankRowIdx + 1, 8);
    gtSurplusRow.height = 24;
    gtSurplusRow.getCell(1).font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    gtSurplusRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
    gtSurplusRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF' + BRAND.primaryGreen },
    };
    gtSurplusRow.getCell(9).numFmt = '$#,##0.00';
    gtSurplusRow.getCell(9).font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    gtSurplusRow.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
    gtSurplusRow.getCell(9).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF' + BRAND.primaryGreen },
    };

    const gtBsRow = ws.addRow([
      'MONTO TOTAL PAGOS BS. (Bs.):',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      report.grandTotalBs,
    ]);
    ws.mergeCells(blankRowIdx + 2, 1, blankRowIdx + 2, 8);
    gtBsRow.height = 24;
    gtBsRow.getCell(1).font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    gtBsRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
    gtBsRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF' + BRAND.primaryGreen },
    };
    gtBsRow.getCell(9).numFmt = '"Bs. "#,##0.00';
    gtBsRow.getCell(9).font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    gtBsRow.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
    gtBsRow.getCell(9).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF' + BRAND.primaryGreen },
    };

    const gtUsdRow = ws.addRow([
      'MONTO TOTAL PAGOS USD ($):',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      report.grandTotalUsd,
    ]);
    ws.mergeCells(blankRowIdx + 3, 1, blankRowIdx + 3, 8);
    gtUsdRow.height = 24;
    gtUsdRow.getCell(1).font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    gtUsdRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
    gtUsdRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF' + BRAND.primaryGreen },
    };
    gtUsdRow.getCell(9).numFmt = '$#,##0.00';
    gtUsdRow.getCell(9).font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    gtUsdRow.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
    gtUsdRow.getCell(9).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF' + BRAND.primaryGreen },
    };

    // Set precise columns width
    ws.getColumn(1).width = 15; // Contract code
    ws.getColumn(2).width = 30; // Titular
    ws.getColumn(3).width = 15; // Payment Date
    ws.getColumn(4).width = 18; // Reference
    ws.getColumn(5).width = 18; // Method
    ws.getColumn(6).width = 15; // Status
    ws.getColumn(7).width = 18; // Surplus
    ws.getColumn(8).width = 18; // Amount Bs
    ws.getColumn(9).width = 18; // Amount USD

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Generate the formatted PDF report buffer.
   */
  async generatePdf(year: number, month: number, advisorId?: string): Promise<Buffer> {
    const report = await this.buildReportData(year, month, advisorId);

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
      } catch (err) {
        this.logger.warn('Company logo.png not found. PDF will render without it.', err);
      }
    }

    const templateData = {
      logo: logoBase64 || null,
      generatedAt,
      advisorName: report.advisorName,
      billingMonthLabel: report.billingMonthLabel,
      sections: report.sections,
      grandTotalSurplusFormatted: report.grandTotalSurplusFormatted,
      grandTotalBsFormatted: report.grandTotalBsFormatted,
      grandTotalUsdFormatted: report.grandTotalUsdFormatted,
    };

    return this.pdfService.generatePdf('advisor-payments', templateData, { landscape: true });
  }
}
