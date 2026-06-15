import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { Repository } from 'typeorm';
import { Invoice } from '../billing/entities/invoice.entity';
import { PaymentStatus } from '../billing/entities/payment.entity';
import { ContractStatus } from '../contracts/entities/contract.entity';
import { PdfService } from '../pdf/services/pdf.service';
import {
  applyDataCellStyle,
  applyGrandTotalStyle,
  applyTableHeaderStyle,
  applyTitleRowStyle,
  BRAND_COLORS,
  createWorkbook,
  finishWorkbook,
  getGeneratedAtTimestamp,
  loadLogoBase64,
  MONTH_NAMES_ES,
} from './report-utils';

interface ContractReportRow {
  contractCode: string;
  titular: string;
  monthlyAmount: number;
  totalAmount: number;
  paidAmountUsd: number;
  paidAmountBs: number;
  invoiceStatus: string;
  isPaid: boolean;
  paymentDate: string | null;
  // Pre-processed fields for the PDF template
  monthlyAmountFormatted: string;
  totalAmountFormatted: string;
  paidAmountUsdFormatted: string;
  paidAmountBsFormatted: string;
  statusClass: string;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly pdfService: PdfService,
  ) {}

  async getContractDetailReport(year: number, month: number): Promise<ContractReportRow[]> {
    const billingMonth = `${year}-${String(month).padStart(2, '0')}`;

    const invoices = await this.invoiceRepository.find({
      where: {
        billingMonth,
        contract: {
          status: ContractStatus.ACTIVE,
        },
      },
      relations: [
        'contract',
        'contract.contractPersons',
        'contract.contractPersons.person',
        'payments',
      ],
    });

    return invoices.map((invoice) => {
      const contract = invoice.contract;

      // Find the TITULAR person
      const titularCp = contract.contractPersons?.find((cp) => cp.isBillingOwner);
      const titular = titularCp?.person
        ? `${titularCp.person.typeIdentityCard}-${titularCp.person.identityCard} ${titularCp.person.name}`
        : 'Sin titular';

      // Sum completed payments
      const completedPayments = (invoice.payments || []).filter(
        (p) => p.status === PaymentStatus.COMPLETED,
      );
      const paidAmountUsd = completedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const paidAmountBs = completedPayments.reduce((sum, p) => sum + Number(p.amountBs || 0), 0);

      // Last completed payment date
      const lastPayment = completedPayments
        .filter((p) => p.paymentDate)
        .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime())[0];
      const paymentDate = lastPayment
        ? new Date(lastPayment.paymentDate).toLocaleDateString('es-VE')
        : null;

      // Status class for PDF styling
      const statusMap: Record<string, string> = {
        PAID: 'paid',
        PARTIAL: 'partial',
        PENDING: 'pending',
        CANCELLED: 'cancelled',
      };

      // Spanish translations for report exports
      const statusLabelMap: Record<string, string> = {
        PAID: 'PAGADO',
        PARTIAL: 'PARCIAL',
        PENDING: 'PENDIENTE',
        CANCELLED: 'ANULADO',
      };

      return {
        contractCode: contract.code,
        titular,
        monthlyAmount: Number(contract.monthlyAmount),
        totalAmount: Number(invoice.totalAmount),
        paidAmountUsd,
        paidAmountBs,
        invoiceStatus: statusLabelMap[invoice.status] || invoice.status,
        isPaid: invoice.status === 'PAID',
        paymentDate,
        monthlyAmountFormatted: Number(contract.monthlyAmount).toFixed(2),
        totalAmountFormatted: Number(invoice.totalAmount).toFixed(2),
        paidAmountUsdFormatted: paidAmountUsd.toFixed(2),
        paidAmountBsFormatted: paidAmountBs.toFixed(2),
        statusClass: statusMap[invoice.status] || 'pending',
      };
    });
  }

  async generateExcel(year: number, month: number): Promise<Buffer> {
    const rows = await this.getContractDetailReport(year, month);
    const monthLabel = MONTH_NAMES_ES[month - 1] || '';
    const { workbook, ws } = createWorkbook('Contratos');
    const totalCols = 9;

    this.renderTitleAndSubheaders(ws, monthLabel, year, totalCols);
    this.renderTableHeaders(ws, totalCols);
    const sums = this.renderDataRows(ws, rows, totalCols);
    this.renderGrandTotal(ws, sums, totalCols);

    // Set columns widths
    ws.getColumn(1).width = 18; // Código Contrato
    ws.getColumn(2).width = 35; // Titular
    ws.getColumn(3).width = 20; // Monto Mensual
    ws.getColumn(4).width = 20; // Total Factura
    ws.getColumn(5).width = 20; // Monto Pagado ($)
    ws.getColumn(6).width = 20; // Monto Pagado (Bs)
    ws.getColumn(7).width = 18; // Estado Factura
    ws.getColumn(8).width = 10; // Pagado
    ws.getColumn(9).width = 16; // Fecha de Pago

    return finishWorkbook(workbook);
  }

  private renderTitleAndSubheaders(
    ws: ExcelJS.Worksheet,
    monthLabel: string,
    year: number,
    totalCols: number,
  ): void {
    const titleRow = ws.addRow([
      `REPORTE DE DETALLE DE CONTRATOS - ${monthLabel.toUpperCase()} ${year}`,
    ]);
    ws.mergeCells(1, 1, 1, totalCols);
    applyTitleRowStyle(titleRow.getCell(1));
    titleRow.height = 40;

    const generatedAt = getGeneratedAtTimestamp();
    const infoRow = ws.addRow([`Generado: ${generatedAt}`]);
    ws.mergeCells(2, 1, 2, totalCols);
    infoRow.getCell(1).font = {
      name: 'Calibri',
      size: 10,
      italic: true,
      color: { argb: `FF${BRAND_COLORS.mediumText}` },
    };
    infoRow.height = 20;

    ws.addRow([]); // Blank row
  }

  private renderTableHeaders(ws: ExcelJS.Worksheet, totalCols: number): void {
    const headers = [
      'CÓDIGO CONTRATO',
      'TITULAR',
      'MONTO MENSUAL ($)',
      'TOTAL FACTURA ($)',
      'MONTO PAGADO ($)',
      'MONTO PAGADO (Bs)',
      'ESTADO FACTURA',
      'PAGADO',
      'FECHA DE PAGO',
    ];
    const headerRow = ws.addRow(headers);
    headerRow.height = 24;
    for (let c = 1; c <= totalCols; c++) {
      applyTableHeaderStyle(headerRow.getCell(c));
    }
  }

  private renderDataRows(
    ws: ExcelJS.Worksheet,
    rows: ContractReportRow[],
    totalCols: number,
  ): {
    monthlyAmountSum: number;
    totalFacturaSum: number;
    paidAmountUsdSum: number;
    paidAmountBsSum: number;
  } {
    let monthlyAmountSum = 0;
    let totalFacturaSum = 0;
    let paidAmountUsdSum = 0;
    let paidAmountBsSum = 0;

    for (const r of rows) {
      const rowData = [
        r.contractCode,
        r.titular,
        r.monthlyAmount,
        r.totalAmount,
        r.paidAmountUsd,
        r.paidAmountBs,
        r.invoiceStatus,
        r.isPaid ? 'Sí' : 'No',
        r.paymentDate || '',
      ];
      const row = ws.addRow(rowData);
      row.height = 20;

      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(2).alignment = { horizontal: 'left' };
      row.getCell(3).alignment = { horizontal: 'right' };
      row.getCell(3).numFmt = '$#,##0.00';
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(4).numFmt = '$#,##0.00';
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(5).numFmt = '$#,##0.00';
      row.getCell(6).alignment = { horizontal: 'right' };
      row.getCell(6).numFmt = '$#,##0.00';
      row.getCell(7).alignment = { horizontal: 'center' };
      row.getCell(8).alignment = { horizontal: 'center' };
      row.getCell(9).alignment = { horizontal: 'center' };

      for (let c = 1; c <= totalCols; c++) {
        applyDataCellStyle(row.getCell(c));
      }

      monthlyAmountSum += r.monthlyAmount;
      totalFacturaSum += r.totalAmount;
      paidAmountUsdSum += r.paidAmountUsd;
      paidAmountBsSum += r.paidAmountBs;
    }

    return {
      monthlyAmountSum,
      totalFacturaSum,
      paidAmountUsdSum,
      paidAmountBsSum,
    };
  }

  private renderGrandTotal(
    ws: ExcelJS.Worksheet,
    sums: {
      monthlyAmountSum: number;
      totalFacturaSum: number;
      paidAmountUsdSum: number;
      paidAmountBsSum: number;
    },
    totalCols: number,
  ): void {
    const grandTotalRow = ws.addRow([
      'TOTAL GENERAL',
      '',
      sums.monthlyAmountSum,
      sums.totalFacturaSum,
      sums.paidAmountUsdSum,
      sums.paidAmountBsSum,
      '',
      '',
      '',
    ]);
    ws.mergeCells(grandTotalRow.number, 1, grandTotalRow.number, 2);
    grandTotalRow.height = 24;

    for (let c = 1; c <= totalCols; c++) {
      applyGrandTotalStyle(grandTotalRow.getCell(c), c === 1 ? 'left' : 'right');
    }

    grandTotalRow.getCell(3).numFmt = '$#,##0.00';
    grandTotalRow.getCell(4).numFmt = '$#,##0.00';
    grandTotalRow.getCell(5).numFmt = '$#,##0.00';
    grandTotalRow.getCell(6).numFmt = '$#,##0.00';
  }

  async generatePdf(year: number, month: number): Promise<Buffer> {
    const rows = await this.getContractDetailReport(year, month);
    const monthLabel = MONTH_NAMES_ES[month - 1] || '';
    const generatedAt = getGeneratedAtTimestamp();
    const logoBase64 = await loadLogoBase64(this.logger);

    return this.pdfService.generatePdf(
      'contract-report',
      {
        rows,
        month,
        year,
        monthLabel,
        generatedAt,
        logo: logoBase64,
      },
      { landscape: true },
    );
  }
}
