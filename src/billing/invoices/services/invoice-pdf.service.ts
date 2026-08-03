import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';
import { PaymentStatus } from '../../payments/entities/payment.entity';
import { PdfService } from '../../../pdf/services/pdf.service';
import { formatDateES, getCaracasDateTime, getCaracasNow } from '../../../common/utils/date.util';
import { fetchReceiptAsBase64 } from '../../utils/image-fetcher.util';
import { extractOcrDisplayFields } from '../../utils/ocr-display.util';

/**
 * Servicio responsable de la generación del PDF de una factura.
 *
 * Al extraer esta responsabilidad fuera de `InvoiceService`, se elimina
 * el antipatrón de pasar `PdfService` como parámetro de método para evitar
 * una dependencia circular. Ahora `PdfService` se inyecta normalmente
 * en el constructor.
 */
@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  private readonly CATEGORY_LABELS: Record<string, string> = {
    INCLUSION: 'Inclusión',
    COMISION: 'Comisión',
    RECOBRO: 'Recobro',
    IMPUESTO: 'Impuesto',
  };

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Construye el PDF de una factura y devuelve el buffer y nombre de archivo.
   * Genera una página por cada pago COMPLETED, o una página resumen si no hay pagos.
   *
   * @param invoiceId - ID de la factura a exportar
   * @returns { pdfBuffer, filename }
   */
  async buildInvoicePdf(invoiceId: string): Promise<{ pdfBuffer: Buffer; filename: string }> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: [
        'contract',
        'contract.advisor',
        'contract.contractPersons',
        'contract.contractPersons.plan',
        'contract.contractPersons.person',
        'contract.contractPersons.person.plan',
        'lines',
        'lines.person',
        'lines.plan',
        'payments',
      ],
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice "${invoiceId}" not found`);
    }

    const contract = invoice.contract;
    if (!contract) {
      throw new NotFoundException(`Invoice "${invoiceId}" has no associated contract`);
    }

    const today = formatDateES(getCaracasNow(), 'dd/MM/yyyy');

    // Titular del contrato
    const titularCp = contract.contractPersons?.find((cp) => cp.isBillingOwner);
    const titular = titularCp?.person;
    const personName = titular?.name ?? 'Sin titular';
    const identityCard = titular ? `${titular.typeIdentityCard}-${titular.identityCard}` : 'N/A';

    const allLines = invoice.lines ?? [];

    const members = allLines
      .filter((l) => l.category === InvoiceLineCategory.MENSUALIDAD)
      .map((l) => ({
        name: l.person?.name ?? 'N/A',
        identityCard: l.person ? `${l.person.typeIdentityCard}-${l.person.identityCard}` : 'N/A',
        plan: l.plan?.name ?? 'N/A',
        amountUsd: `$${Number(l.amount).toFixed(2)}`,
      }));

    const additionalCharges = allLines
      .filter((l) => l.category !== InvoiceLineCategory.MENSUALIDAD)
      .map((l) => ({
        category: this.CATEGORY_LABELS[l.category] ?? l.category,
        description: l.description,
        quantity: String(l.quantity ?? 1),
        unitAmount: `$${Number(l.amount).toFixed(2)}`,
        totalLine: `$${(Number(l.amount) * Number(l.quantity ?? 1)).toFixed(2)}`,
      }));

    // Resumen de planes
    const planCounts: Record<string, number> = {};
    for (const member of members) {
      planCounts[member.plan] = (planCounts[member.plan] || 0) + 1;
    }
    const planSummary = Object.entries(planCounts)
      .map(([planName, count]) => ({ planName, count }))
      .sort((a, b) => b.count - a.count);

    const totalAmount = Number(invoice.totalAmount);
    const formatted = new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    // Pagos completados ordenados del más reciente al más antiguo
    const completedPayments = (invoice.payments ?? [])
      .filter((p) => p.status === PaymentStatus.COMPLETED)
      .sort(
        (a, b) =>
          getCaracasDateTime(b.paymentDate).toMillis() -
          getCaracasDateTime(a.paymentDate).toMillis(),
      );

    // Una página por pago; si no hay pagos, una página resumen
    const pagesToRender = completedPayments.length > 0 ? completedPayments : [null];

    const invoicePages = await Promise.all(
      pagesToRender.map(async (payment) => {
        const amountUsd = payment ? Number(payment.amount) : Number(invoice.paidAmount);
        const amountBsRaw = payment ? Number(payment.amountBs ?? 0) : 0;
        const retentionAmount = Number(invoice.retentionAmount || 0);
        const amountDue = Math.max(0, totalAmount - retentionAmount);
        const amountUnpaid = Math.max(0, amountDue - Number(invoice.paidAmount));

        const exchangeRate =
          amountBsRaw > 0 && amountUsd > 0 ? (amountBsRaw / amountUsd).toFixed(4) : null;

        // Descargar imagen del recibo como base64 para Puppeteer
        const receiptUrl = payment?.url
          ? await fetchReceiptAsBase64(payment.url, this.logger)
          : null;

        const { bancoDestino, montoExtraido } = extractOcrDisplayFields(payment?.metadata);

        return {
          contractCode: contract.code,
          legacyCode: contract.legacyCode ?? null,
          billingMonth: invoice.billingMonth,
          personName,
          identityCard,
          members,
          planSummary,
          additionalCharges,
          hasAdditionalCharges: additionalCharges.length > 0,
          today,
          paymentMethod: payment?.paymentMethod ?? '—',
          referenceNumber: payment?.referenceNumber ?? '',
          amountUsd: formatted.format(amountUsd),
          amountBs: amountBsRaw > 0 ? formatted.format(amountBsRaw) : null,
          exchangeRateUsdToBs: exchangeRate ? formatted.format(Number(exchangeRate)) : null,
          totalAmount: formatted.format(totalAmount),
          retentionPercentage: invoice.retentionPercentage
            ? formatted.format(Number(invoice.retentionPercentage))
            : null,
          retentionAmount: retentionAmount > 0 ? formatted.format(retentionAmount) : null,
          amountDue: formatted.format(amountDue),
          amountUnpaid: formatted.format(amountUnpaid),
          date: today,
          advisor: contract.advisor?.name ?? 'Sin asesor',
          receiptUrl,
          bancoDestino,
          montoExtraido,
        };
      }),
    );

    const pdfBuffer = await this.pdfService.generatePdf('invoice', {
      invoices: invoicePages,
      logoBase64: null,
    });

    const filename = `factura-${contract.code}-${invoice.billingMonth}.pdf`;
    return { pdfBuffer, filename };
  }
}
