import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { SubmitPaymentDto } from './dto/submit-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private awsService: AwsService,
    private emailService: EmailService,
  ) {}

  async processPaymentReceipt(
    dto: SubmitPaymentDto,
    file: Express.Multer.File,
  ): Promise<{ message: string; receiptUrl: string }> {
    try {
      // 1. Upload the image to S3
      const receiptUrl = await this.awsService.uploadFile(file);

      // 2. Send email with the payment info and receipt URL
      await this.emailService.sendPaymentConfirmation(
        dto.email,
        dto,
        receiptUrl,
      );

      return {
        message: 'Payment information collected and email sent successfully.',
        receiptUrl,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to process payment receipt: ${error.message}`,
      );
    }
  }
}
