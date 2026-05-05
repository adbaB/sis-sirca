import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AwsService } from '../aws/aws.service';
import { SubmitPaymentDto } from './dto/submit-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(private awsService: AwsService) {}

  async processPaymentReceipt(
    dto: SubmitPaymentDto,
    file: Express.Multer.File,
  ): Promise<{ message: string; receiptUrl: string }> {
    try {
      // 1. Upload the image to S3
      const receiptUrl = await this.awsService.uploadFile(file);

      return {
        message: 'Payment information collected successfully.',
        receiptUrl,
      };
    } catch (error) {
      throw new InternalServerErrorException(`Failed to process payment receipt: ${error.message}`);
    }
  }
}
