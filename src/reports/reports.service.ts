import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Invoice } from '../billing/entities/invoice.entity';
import { PaymentStatus } from '../billing/entities/payment.entity';
import { PdfService } from '../pdf/services/pdf.service';
import { ContractStatus } from 'src/contracts/entities/contract.entity';

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

    const wsData = [
      [
        'Código Contrato',
        'Titular',
        'Monto Mensual ($)',
        'Total Factura ($)',
        'Monto Pagado ($)',
        'Monto Pagado (Bs)',
        'Estado Factura',
        'Pagado',
        'Fecha de Pago',
      ],
      ...rows.map((r) => [
        r.contractCode,
        r.titular,
        r.monthlyAmount,
        r.totalAmount,
        r.paidAmountUsd,
        r.paidAmountBs,
        r.invoiceStatus,
        r.isPaid ? 'Sí' : 'No',
        r.paymentDate || '',
      ]),
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 18 }, // Código Contrato
      { wch: 35 }, // Titular
      { wch: 16 }, // Monto Mensual
      { wch: 16 }, // Total Factura
      { wch: 16 }, // Monto Pagado ($)
      { wch: 18 }, // Monto Pagado (Bs)
      { wch: 16 }, // Estado Factura
      { wch: 8 }, // Pagado
      { wch: 16 }, // Fecha de Pago
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Contratos');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return Buffer.from(buffer);
  }

  async generatePdf(year: number, month: number): Promise<Buffer> {
    const rows = await this.getContractDetailReport(year, month);

    const monthLabel = MONTH_NAMES_ES[month - 1] || '';
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
