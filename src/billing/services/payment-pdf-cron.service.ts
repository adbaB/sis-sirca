import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IsNull, Repository } from 'typeorm';

import { AwsService } from '../../aws/aws.service';
import configurations from '../../config/configurations';
import { ContractPerson } from '../../contracts/entities/contract-person.entity';
import { Contract } from '../../contracts/entities/contract.entity';
import { EmailService } from '../../email/email.service';
import { PdfService } from '../../pdf/services/pdf.service';
import { InvoiceLine } from '../entities/invoice-line.entity';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';
import { Payment, PaymentStatus } from '../entities/payment.entity';

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
  @Cron(CronExpression.EVERY_10_MINUTES)
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
        'invoice.lines',
        'invoice.lines.person',
        'invoice.lines.plan',
      ],
    });

    if (payments.length === 0) {
      this.logger.log('CRON [payment-pdf]: No hay pagos pendientes de PDF.');
      return;
    }

    this.logger.log(`CRON [payment-pdf]: Procesando ${payments.length} pago(s)...`);

    const today = new Date().toLocaleDateString('es-VE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Caracas',
    });

    const { invoices, validPayments } = await this.buildInvoicesData(payments, today);

    if (invoices.length === 0) {
      this.logger.warn('[payment-pdf] Ningún pago válido para generar PDF. Abortando.');
      return;
    }

    const pdfUrls = await this.generateAndUploadPdfs(invoices, today);
    if (!pdfUrls) return;

    const emailSent = await this.sendNotificationEmail(validPayments.length, pdfUrls, today);
    if (!emailSent) return;

    await this.markPaymentsAsSent(validPayments);
  }

  private extractTitularInfo(contract: Contract): { personName: string; identityCard: string } {
    const titularCp = contract.contractPersons?.find(
      (cp: ContractPerson) => cp.isBillingOwner === true,
    );
    const titular = titularCp?.person;
    return {
      personName: titular?.name ?? 'Sin titular',
      identityCard: titular ? `${titular.typeIdentityCard}-${titular.identityCard}` : 'N/A',
    };
  }

  private extractMembersInfo(lines: InvoiceLine[]): Record<string, string>[] {
    return (lines ?? [])
      .filter((line) => line.category === InvoiceLineCategory.MENSUALIDAD)
      .map((line) => ({
        name: line.person?.name ?? 'N/A',
        identityCard: line.person
          ? `${line.person.typeIdentityCard}-${line.person.identityCard}`
          : 'N/A',
        plan: line.plan?.name ?? 'N/A',
        amountUsd: `$${Number(line.amount).toFixed(2)}`,
      }));
  }

  private extractChargesInfo(lines: InvoiceLine[]): Record<string, string>[] {
    const CATEGORY_LABELS: Record<string, string> = {
      INCLUSION: 'Inclusión',
      COMISION: 'Comisión',
      RECOBRO: 'Recobro',
      IMPUESTO: 'Impuesto',
    };
    return (lines ?? [])
      .filter((line) => line.category !== InvoiceLineCategory.MENSUALIDAD)
      .map((line) => ({
        category: CATEGORY_LABELS[line.category] ?? line.category,
        description: line.description,
        quantity: String(line.quantity ?? 1),
        unitAmount: `$${Number(line.amount).toFixed(2)}`,
        totalLine: `$${(Number(line.amount) * Number(line.quantity ?? 1)).toFixed(2)}`,
      }));
  }

  private calculateFinancialInfo(payment: Payment): {
    amountUsd: string;
    amountBs: string | null;
    exchangeRateUsdToBs: string | null;
    totalAmount: string;
    amountUnpaid: string;
  } {
    const amountBs = Number(payment.amountBs);
    const amountUsd = Number(payment.amount);
    const totalAmount = Number(payment.invoice?.totalAmount);
    const amountUnpaid = Number(totalAmount - amountUsd);
    const exchangeRate = amountBs > 0 && amountUsd > 0 ? (amountBs / amountUsd).toFixed(4) : null;
    const formatted = new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return {
      amountUsd: formatted.format(amountUsd),
      amountBs: amountBs > 0 ? formatted.format(amountBs) : null,
      exchangeRateUsdToBs: formatted.format(Number(exchangeRate)),
      totalAmount: formatted.format(totalAmount),
      amountUnpaid: formatted.format(amountUnpaid),
    };
  }

  private async buildSingleInvoiceData(
    payment: Payment,
    today: string,
  ): Promise<Record<string, unknown> | null> {
    const invoice = payment.invoice;
    const contract = invoice?.contract;

    if (!invoice || !contract) {
      this.logger.warn(
        `[payment-pdf] Pago ${payment.id}: sin factura o contrato asociado. Saltando.`,
      );
      return null;
    }

    const { personName, identityCard } = this.extractTitularInfo(contract);
    const allLines = invoice.lines as InvoiceLine[];
    const members = this.extractMembersInfo(allLines);
    const additionalCharges = this.extractChargesInfo(allLines);
    const financialInfo = this.calculateFinancialInfo(payment);

    const advisor = contract.advisor?.name ?? 'Sin asesor';
    const receiptDataUri = payment.url ? await this.fetchImageAsBase64(payment.url) : null;

    return {
      contractCode: contract.code,
      billingMonth: invoice.billingMonth,
      personName,
      identityCard,
      members,
      additionalCharges,
      hasAdditionalCharges: additionalCharges.length > 0,
      today,
      paymentMethod: payment.paymentMethod,
      referenceNumber: payment.referenceNumber,
      ...financialInfo,
      date: today,
      advisor,
      receiptUrl: receiptDataUri,
    };
  }

  private async buildInvoicesData(
    payments: Payment[],
    today: string,
  ): Promise<{ invoices: Record<string, unknown>[]; validPayments: Payment[] }> {
    const invoices: Record<string, unknown>[] = [];
    const validPayments: Payment[] = [];

    for (const payment of payments) {
      const invoiceData = await this.buildSingleInvoiceData(payment, today);
      if (invoiceData) {
        invoices.push(invoiceData);
        validPayments.push(payment);
      }
    }

    return { invoices, validPayments };
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  private logError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(`${context}: ${message}`, stack);
  }

  private getFilename(today: string, totalChunks: number, currentIndex: number): string {
    return totalChunks > 1
      ? `comprobantes-${today.replace(/\//g, '-')}-parte${currentIndex + 1}.pdf`
      : `comprobantes-${today.replace(/\//g, '-')}.pdf`;
  }

  private getEmailBodyText(validPaymentsCount: number, pdfUrlsLength: number): string {
    if (pdfUrlsLength > 1) {
      return `Se han procesado ${validPaymentsCount} pago(s). Debido a la cantidad, los comprobantes se han dividido en ${pdfUrlsLength} archivos PDF. Descárgalos a continuación:`;
    }
    return `Se han procesado ${validPaymentsCount} pago(s). Descarga el PDF con todos los comprobantes:`;
  }

  private async generateAndUploadPdfs(
    invoices: Record<string, unknown>[],
    today: string,
  ): Promise<string[] | null> {
    const invoiceChunks = this.chunkArray(invoices, 100);
    const pdfUrls: string[] = [];
    const logoBase64 = await this.loadLogoBase64();

    for (let i = 0; i < invoiceChunks.length; i++) {
      const chunk = invoiceChunks[i];
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await this.pdfService.generatePdf('invoice', { invoices: chunk, logoBase64 });
      } catch (pdfError) {
        this.logError(`[payment-pdf] Error generando el PDF (Parte ${i + 1})`, pdfError);
        return null;
      }

      const filename = this.getFilename(today, invoiceChunks.length, i);

      try {
        const pdfUrl = await this.awsService.uploadFile(
          { buffer: pdfBuffer, originalname: filename, mimetype: 'application/pdf' },
          'pdfs',
        );
        this.logger.log(`[payment-pdf] PDF subido a S3: ${pdfUrl}`);
        pdfUrls.push(pdfUrl);
      } catch (uploadError) {
        this.logError(`[payment-pdf] Error subiendo PDF a S3 (Parte ${i + 1})`, uploadError);
        return null;
      }
    }
    return pdfUrls;
  }

  private async sendNotificationEmail(
    validPaymentsCount: number,
    pdfUrls: string[],
    today: string,
  ): Promise<boolean> {
    const notificationEmail = this.configService.aws.notificationEmail || 'atencion@sirca.com.ve';
    const subject = `Comprobantes de Pago SIRCA (${today}) — ${validPaymentsCount} pago(s)`;
    const bodyText = this.getEmailBodyText(validPaymentsCount, pdfUrls.length);

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
      return true;
    } catch (mailError) {
      this.logError('[payment-pdf] Error enviando el correo', mailError);
      return false;
    }
  }

  private async markPaymentsAsSent(payments: Payment[]): Promise<void> {
    const now = new Date();
    for (const payment of payments) {
      payment.sendAt = now;
    }
    await this.paymentRepository.save(payments);
    this.logger.log(
      `[payment-pdf] PDF enviado (${payments.length} pago(s)). sendAt actualizado en todos.`,
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
    const result = await fetchSafeImage(url, this.logger);
    if (!result) return null;
    return `data:${result.contentType};base64,${result.base64}`;
  }
}

function isTrustedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    const trustedHosts = ['s3.aws.com', 'amazonaws.com', 's3.amazonaws.com'];
    if (trustedHosts.includes(hostname)) {
      return true;
    }
    if (hostname.endsWith('.amazonaws.com')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function fetchSafeImage(
  url: string,
  logger: { warn(msg: string): void },
): Promise<{ contentType: string; base64: string } | null> {
  if (!isTrustedUrl(url)) {
    logger.warn(`[SSRF Blocked] Attempted outbound request to untrusted URL: ${url}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000), // 5 seconds timeout
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';

    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalSize = 0;
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalSize += value.length;
        if (totalSize > MAX_SIZE) {
          await reader.cancel();
          logger.warn(`[Resource Exhaustion Blocked] Image size exceeded limit of 10MB: ${url}`);
          return null;
        }
        chunks.push(Buffer.from(value));
      }
    }

    const buffer = Buffer.concat(chunks);
    const base64 = buffer.toString('base64');
    return { contentType, base64 };
  } catch (err) {
    logger.warn(
      `[fetchSafeImage] Error fetching image: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
