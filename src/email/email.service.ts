import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import configurations from '../config/configurations';
import { SubmitPaymentDto } from '../payments/dto/submit-payment.dto';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private sesClient: SESClient;

  constructor(
    @Inject(configurations.KEY)
    private configService: ConfigType<typeof configurations>,
  ) {
    const sesConfig: {
      region?: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {
      region: this.configService.aws.region,
    };

    if (this.configService.aws.accessKeyId && this.configService.aws.secretAccessKey) {
      sesConfig.credentials = {
        accessKeyId: this.configService.aws.accessKeyId,
        secretAccessKey: this.configService.aws.secretAccessKey,
      };
    }

    this.sesClient = new SESClient(sesConfig);
  }

  async sendPaymentConfirmation(
    to: string,
    userInfo: SubmitPaymentDto | Record<string, unknown>,
    receiptUrl: string,
  ): Promise<void> {
    const htmlBody = `
      <h1>Confirmación de Pago</h1>
      <p>Hola ${userInfo.name || 'Cliente'},</p>
      <p>Hemos recibido la información de tu pago.</p>
      <h3>Detalles de Usuario:</h3>
      <ul>
        ${Object.entries(userInfo)
          .map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`)
          .join('')}
      </ul>
      <p>Puedes ver tu comprobante de pago en el siguiente enlace:</p>
      <a href="${receiptUrl}">Ver Comprobante</a>
      <br/><br/>
      <p>Gracias por confiar en SIRCA.</p>
    `;

    const notificationEmail = this.configService.aws.notificationEmail || 'atencion@sirca.com.ve';

    const command = new SendEmailCommand({
      Source: this.configService.aws.sesFromEmail,
      Destination: {
        ToAddresses: [notificationEmail],
      },
      Message: {
        Subject: {
          Data: 'Confirmación de Pago - SIRCA',
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8',
          },
        },
      },
    });

    try {
      await this.sesClient.send(command);
    } catch (error) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(`Failed to send email: ${error.message}`);
      }
      throw new InternalServerErrorException('Failed to send email with unknown error');
    }
  }

  /**
   * Sends a PDF file as an email attachment via AWS SES raw message.
   * @param to         Recipient address
   * @param subject    Email subject
   * @param body       Plain-text body
   * @param pdfBuffer  PDF content
   * @param filename   Attachment filename (e.g. 'comprobante-2024-05.pdf')
   */
  async sendPaymentPdf(
    to: string,
    subject: string,
    body: string,
    pdfBuffer: Buffer,
    filename: string,
  ): Promise<void> {
    const boundary = `----=_Part_${Date.now()}`;
    const from = this.configService.aws.sesFromEmail;

    const rawMessage = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
      '',
      `--${boundary}`,
      `Content-Type: application/pdf; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      pdfBuffer.toString('base64'),
      '',
      `--${boundary}--`,
    ].join('\r\n');

    const command = new SendRawEmailCommand({
      RawMessage: { Data: Buffer.from(rawMessage) },
    });

    try {
      await this.sesClient.send(command);
      this.logger.log(`PDF email sent to ${to}: ${filename}`);
    } catch (error) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(`Failed to send PDF email: ${error.message}`);
      }
      throw new InternalServerErrorException('Failed to send PDF email with unknown error');
    }
  }

  /**
   * Sends a lightweight HTML email containing a link to a PDF hosted on S3.
   * Use this instead of sendPaymentPdf when the PDF exceeds SES's 10 MB limit.
   */
  async sendPdfLink(to: string, subject: string, pdfUrl: string, body: string): Promise<void> {
    const htmlBody = `
      <p>${body.replace(/\n/g, '<br>')}</p>
      <p><a href="${pdfUrl}" style="background:#0f4c81;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold;">
        📄 Descargar Comprobantes PDF
      </a></p>
      <p style="color:#888;font-size:12px;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${pdfUrl}</p>
    `;

    const command = new SendEmailCommand({
      Source: this.configService.aws.sesFromEmail,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: htmlBody, Charset: 'UTF-8' } },
      },
    });

    try {
      await this.sesClient.send(command);
      this.logger.log(`PDF link email sent to ${to}`);
    } catch (error) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(`Failed to send PDF link email: ${error.message}`);
      }
      throw new InternalServerErrorException('Failed to send PDF link email with unknown error');
    }
  }
}
