import { Injectable, InternalServerErrorException, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import configurations from '../config/configurations';
import { SubmitPaymentDto } from '../payments/dto/submit-payment.dto';

@Injectable()
export class EmailService {
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
    userInfo: SubmitPaymentDto,
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
      <p>Gracias por confiar en SIRCA Seguros.</p>
    `;

    const notificationEmail =
      this.configService.aws.notificationEmail || 'albertobasabe487@gmail.com';

    const command = new SendEmailCommand({
      Source: this.configService.aws.sesFromEmail,
      Destination: {
        ToAddresses: [notificationEmail],
      },
      Message: {
        Subject: {
          Data: 'Confirmación de Pago - SIRCA Seguros',
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
}
