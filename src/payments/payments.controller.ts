import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PaymentsService } from './payments.service';
import { SubmitPaymentDto } from './dto/submit-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('submit')
  @UseInterceptors(FileInterceptor('file'))
  async submitPayment(
    @UploadedFile() file: Express.Multer.File,
    @Body() submitPaymentDto: SubmitPaymentDto,
  ) {
    if (!file) {
      throw new BadRequestException('A receipt file is required.');
    }

    // In a real application, you might also want to add file validation
    // to ensure the file is an image (e.g. using ParseFilePipe in NestJS).

    return this.paymentsService.processPaymentReceipt(
      submitPaymentDto,
      file,
    );
  }
}
