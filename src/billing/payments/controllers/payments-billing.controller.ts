import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { RequirePermissions } from '../../../auth/decorators';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PaymentService } from '../services/payment.service';
import { AwsService } from '../../../aws/aws.service';
import { OcrService } from '../../../ocr/ocr.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { parseOcrDateToISO } from '../../../common/utils/date.util';

@Controller('billing')
export class PaymentBillingController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly awsService: AwsService,
    private readonly ocrService: OcrService,
  ) {}

  @Post('payment')
  @RequirePermissions('create:payments')
  createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentService.createPayment(createPaymentDto);
  }

  @Get('payments')
  @RequirePermissions('read:payments')
  getPayments(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('month') month?: number,
    @Query('year') year?: number,
  ) {
    return this.paymentService.findPayments(
      Number(page),
      Number(limit),
      status,
      search,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
    );
  }

  @Get('payments/pending-count')
  @RequirePermissions('read:payments')
  async getPendingCount() {
    const count = await this.paymentService.countPendingPayments();
    return { count };
  }

  @Patch('payments/:id/approve')
  @RequirePermissions('update:payments')
  approvePayment(@Param('id') id: string) {
    return this.paymentService.approvePayment(id);
  }

  @Patch('payments/:id/reject')
  @RequirePermissions('update:payments')
  rejectPayment(@Param('id') id: string, @Body('reason') reason: string) {
    return this.paymentService.rejectPayment(id, reason || 'Rechazado por el administrador');
  }

  @Patch('payments/:id/date')
  @RequirePermissions('update:payments')
  updatePaymentDate(@Param('id') id: string, @Body('paymentDate') paymentDate: string) {
    return this.paymentService.updatePaymentDate(id, paymentDate);
  }

  @Post('payments/analyze-receipt')
  @RequirePermissions('create:advisor-payments')
  @UseInterceptors(FileInterceptor('file'))
  async analyzeReceipt(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Se requiere un archivo de comprobante.');
    }

    const s3Url = await this.awsService.uploadFile(file);
    const ocrResult = await this.ocrService.extractReceiptData(s3Url);
    const formattedDate = parseOcrDateToISO(ocrResult.fecha);

    const currency = ocrResult.moneda ? ocrResult.moneda.trim().toUpperCase() : '';
    let mappedMethod = 'PAGO_MOVIL';
    if (currency === 'USD') {
      mappedMethod = 'ZELLE';
    } else if (ocrResult.origen) {
      const originUpper = ocrResult.origen.toUpperCase();
      if (originUpper.includes('ZELLE')) {
        mappedMethod = 'ZELLE';
      } else if (originUpper.includes('TRANS') || originUpper.includes('DEP')) {
        mappedMethod = 'TRANSFERENCIA';
      }
    }

    // Set Bs or USD based on currency, without automatic conversion
    let amountUsd: number | null = null;
    let amountBsVal: number | null = null;
    const ocrAmount = ocrResult.monto || 0;

    if (currency === 'BS' || currency === 'VES') {
      amountBsVal = ocrAmount;
    } else {
      amountUsd = ocrAmount;
    }

    return {
      referenceNumber: ocrResult.referencia || '',
      amount: amountUsd,
      amountBs: amountBsVal,
      paymentDate: formattedDate,
      operationDate: formattedDate,
      paymentMethod: mappedMethod,
      bank: ocrResult.nombreBanco || ocrResult.origen || '',
      url: s3Url,
      rawOcr: ocrResult,
    };
  }
}
