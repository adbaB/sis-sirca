import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import nodemailer from 'nodemailer';
import config from '../config/configurations';
import { SubmitPaymentDto } from '../payments/dto/submit-payment.dto';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(
    @Inject(config.KEY)
    private readonly configService: ConfigType<typeof config>,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.smtp.host,
      port: this.configService.smtp.port,
      secure: this.configService.smtp.secure || false,
      auth: {
        user: this.configService.smtp.user,
        pass: this.configService.smtp.pass,
      },
    });
  }

  async sendPaymentConfirmation(
    to: string,
    userInfo: SubmitPaymentDto,
    receiptUrl: string,
  ): Promise<void> {
    const mailOptions = {
      from: this.configService.smtp.from || 'noreply@sirca.com.ve',
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
      throw new InternalServerErrorException(`Failed to send email: ${error.message}`);
    }
  }
}
