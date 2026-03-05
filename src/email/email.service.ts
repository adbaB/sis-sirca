import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: this.configService.get<boolean>('SMTP_SECURE') || false,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendPaymentConfirmation(
    to: string,
    userInfo: any,
    receiptUrl: string,
  ): Promise<void> {
    const mailOptions = {
      from: this.configService.get<string>('SMTP_FROM') || 'noreply@sirca.com',
      to: to,
      subject: 'Confirmación de Pago - SIRCA Seguros',
      html: `
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
        <p>Gracias por confiar en SIRCA Seguros.</p>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to send email: ${error.message}`,
      );
    }
  }
}
