import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SubmitPaymentDto } from './dto/submit-payment.dto';
import { PaymentsService } from './payments.service';
import { RequirePermissions } from '../auth/decorators';
import { BillingService } from '../billing/services/billing.service';
import { CreatePaymentDto } from '../billing/dto/create-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly billingService: BillingService,
  ) {}

  @Post('submit')
  @RequirePermissions('create:payments')
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

    return this.paymentsService.processPaymentReceipt(submitPaymentDto, file);
  }

  @Post()
  @RequirePermissions('create:payments', 'create:advisor-payments')
  async createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.billingService.createPayment(createPaymentDto);
  }
}
