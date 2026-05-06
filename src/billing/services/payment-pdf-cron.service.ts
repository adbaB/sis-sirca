import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IsNull, Repository } from 'typeorm';

import configurations from '../../config/configurations';
import { AwsService } from '../../aws/aws.service';
import { EmailService } from '../../email/email.service';
import { PdfService } from '../../pdf/services/pdf.service';
import { Payment, PaymentStatus } from '../entities/payment.entity';

@Injectable()
export class PaymentPdfCronService {
  private readonly logger = new Logger(PaymentPdfCronService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly pdfService: PdfService,
    private readonly emailService: EmailService,
    private readonly awsService: AwsService,
    @Inject(configurations.KEY)
    private readonly configService: ConfigType<typeof configurations>,
  ) {}

  /**
   * Every hour at minute 5 — collect ALL COMPLETED payments whose sendAt is still
   * null, build a single PDF (one page per payment) and send it in one email.
   * Only after the email is sent successfully are all payments marked with sendAt.
   */
  @Cron('5 * * * *')
  async generateAndSendPendingReceipts(): Promise<void> {
    this.logger.log('CRON [payment-pdf]: Buscando pagos COMPLETED sin envío...');

    const payments = await this.paymentRepository.find({
      where: {
        status: PaymentStatus.COMPLETED,
        sendAt: IsNull(),
      },
      relations: [
        'invoice',
        'invoice.contract',
        'invoice.contract.advisor',
        'invoice.contract.contractPersons',
        'invoice.contract.contractPersons.person',
        'invoice.contract.contractPersons.person.plan',
        'invoice.details',
        'invoice.details.person',
        'invoice.details.plan',
      ],
    });

    if (payments.length === 0) {
      this.logger.log('CRON [payment-pdf]: No hay pagos pendientes de PDF.');
      return;
    }

    this.logger.log(`CRON [payment-pdf]: Procesando ${payments.length} pago(s) en un único PDF...`);

    const today = new Date().toLocaleDateString('es-VE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Caracas',
    });

    // ── Build the invoices array: one entry per payment (= one page in the PDF) ──
    const invoices: Record<string, unknown>[] = [];
    const validPayments: Payment[] = [];

    for (const payment of payments) {
      const invoice = payment.invoice;
      const contract = invoice?.contract;

      if (!invoice || !contract) {
        this.logger.warn(
          `[payment-pdf] Pago ${payment.id}: sin factura o contrato asociado. Saltando.`,
        );
        continue;
      }

      // Titular info
      const titularCp = contract.contractPersons?.find((cp) => cp.isBillingOwner === true);
      const titular = titularCp?.person ?? null;
      const personName = titular?.name ?? 'Sin titular';
      const identityCard = titular ? `${titular.typeIdentityCard}-${titular.identityCard}` : 'N/A';

      // Member list from invoice details
      const members = (invoice.details ?? []).map((detail) => ({
        name: detail.person?.name ?? 'N/A',
        identityCard: detail.person
          ? `${detail.person.typeIdentityCard}-${detail.person.identityCard}`
          : 'N/A',
        plan: detail.plan?.name ?? 'N/A',
        amountUsd: `$${Number(detail.chargedAmount).toFixed(2)}`,
      }));

      const advisor = contract.advisor?.name ?? 'Sin asesor';

      // Pre-fetch the receipt image from S3 and embed it as a data URI so that
      // Puppeteer does not need to make any outbound HTTP requests (avoids timeout).
      const receiptDataUri = payment.url ? await this.fetchImageAsBase64(payment.url) : null;

      invoices.push({
        contractCode: contract.code,
        billingMonth: invoice.billingMonth,
        personName,
        identityCard,
        members,
        today,
        paymentMethod: payment.paymentMethod,
        amountUsd: Number(payment.amount).toFixed(2),
        amountBs: Number(payment.amountBs) > 0 ? Number(payment.amountBs).toFixed(2) : null,
        exchangeRateUsdToBs:
          Number(payment.amountBs) > 0 && Number(payment.amount) > 0
            ? (Number(payment.amountBs) / Number(payment.amount)).toFixed(4)
            : null,
        date: today,
        advisor,
        receiptUrl: receiptDataUri,
      });

      validPayments.push(payment);
    }

    if (invoices.length === 0) {
      this.logger.warn('[payment-pdf] Ningún pago válido para generar PDF. Abortando.');
      return;
    }

    // ── Generate PDFs in chunks of 100 ───────────────────────────────────────
    const chunkArray = <T>(array: T[], size: number): T[][] => {
      const result = [];
      for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
      }
      return result;
    };

    const invoiceChunks = chunkArray(invoices, 100);
    const pdfUrls: string[] = [];
    const logoBase64 = await this.loadLogoBase64();

    for (let i = 0; i < invoiceChunks.length; i++) {
      const chunk = invoiceChunks[i];
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await this.pdfService.generatePdf('invoice', {
          invoices: chunk,
          logoBase64,
        });
      } catch (pdfError) {
        this.logger.error(
          `[payment-pdf] Error generando el PDF (Parte ${i + 1}): ${pdfError instanceof Error ? pdfError.message : String(pdfError)}`,
          pdfError instanceof Error ? pdfError.stack : undefined,
        );
        // Do not mark sendAt — the cron will retry on the next run
        return;
      }

      const filename =
        invoiceChunks.length > 1
          ? `comprobantes-${today.replace(/\//g, '-')}-parte${i + 1}.pdf`
          : `comprobantes-${today.replace(/\//g, '-')}.pdf`;

      try {
        const pdfUrl = await this.awsService.uploadFile(
          { buffer: pdfBuffer, originalname: filename, mimetype: 'application/pdf' },
          'pdfs',
        );
        this.logger.log(`[payment-pdf] PDF subido a S3: ${pdfUrl}`);
        pdfUrls.push(pdfUrl);
      } catch (uploadError) {
        this.logger.error(
          `[payment-pdf] Error subiendo PDF a S3 (Parte ${i + 1}): ${
            uploadError instanceof Error ? uploadError.message : String(uploadError)
          }`,
          uploadError instanceof Error ? uploadError.stack : undefined,
        );
        return;
      }
    }

    // ── Send email with download links ───────────────────────────────────────
    const notificationEmail = this.configService.aws.notificationEmail || 'atencion@sirca.com.ve';
    const subject = `Comprobantes de Pago SIRCA (${today}) — ${validPayments.length} pago(s)`;
    const bodyText =
      invoiceChunks.length > 1
        ? `Se han procesado ${validPayments.length} pago(s). Debido a la cantidad, los comprobantes se han dividido en ${invoiceChunks.length} archivos PDF. Descárgalos a continuación:`
        : `Se han procesado ${validPayments.length} pago(s). Descarga el PDF con todos los comprobantes:`;

    const body = [
      'Estimado equipo SIRCA,',
      '',
      bodyText,
      `Fecha de emisión: ${today}`,
      '',
      'Gracias por confiar en SIRCA Plan de Salud.',
      'Salud Integral El Rosario C.A.',
    ].join('\n');

    try {
      await this.emailService.sendPdfLinks(notificationEmail, subject, pdfUrls, body);
    } catch (mailError) {
      this.logger.error(
        `[payment-pdf] Error enviando el correo: ${
          mailError instanceof Error ? mailError.message : String(mailError)
        }`,
        mailError instanceof Error ? mailError.stack : undefined,
      );
      // Do not mark sendAt — the cron will retry on the next run
      return;
    }

    // ── Mark sendAt on all valid payments ────────────────────────────────────
    const now = new Date();
    for (const payment of validPayments) {
      payment.sendAt = now;
    }
    await this.paymentRepository.save(validPayments);

    this.logger.log(
      `[payment-pdf] PDF enviado (${validPayments.length} pago(s)). sendAt actualizado en todos.`,
    );
  }

  /**
   * Reads the logo from assets and returns a data URI string (for Handlebars {{logoBase64}}).
   * The logo lives at src/assets/images/logo.png in development and is copied to
   * dist/assets/images/logo.png during `nest build` thanks to nest-cli.json assets config.
   * Falls back gracefully to null so the template renders the text fallback.
   */
  private async loadLogoBase64(): Promise<string | null> {
    try {
      // process.cwd() is the project root in both dev (ts-node) and production (node dist/)
      const logoPath = path.join(process.cwd(), 'src', 'assets', 'images', 'logo.png');
      const distLogoPath = path.join(process.cwd(), 'dist', 'assets', 'images', 'logo.png');

      let logoBuffer: Buffer | null = null;
      try {
        logoBuffer = await fs.readFile(distLogoPath);
      } catch {
        // dist not built yet — fall back to src (dev mode)
        logoBuffer = await fs.readFile(logoPath);
      }

      return `data:image/png;base64,${logoBuffer.toString('base64')}`;
    } catch (err) {
      this.logger.warn(
        `[payment-pdf] No se pudo cargar el logo: ${
          err instanceof Error ? err.message : String(err)
        }. Se usará el texto de respaldo.`,
      );
      return null;
    }
  }

  /**
   * Downloads an image from a URL (e.g. S3 presigned URL) and returns it as a
   * data URI so Puppeteer can render it without making outbound HTTP requests.
   * Returns null if the download fails — the template will simply omit the image.
   */
  private async fetchImageAsBase64(url: string): Promise<string | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `[payment-pdf] No se pudo descargar la imagen (${response.status}): ${url}`,
        );
        return null;
      }
      const contentType = response.headers.get('content-type') ?? 'image/jpeg';
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return `data:${contentType};base64,${base64}`;
    } catch (err) {
      this.logger.warn(
        `[payment-pdf] Error descargando imagen: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
