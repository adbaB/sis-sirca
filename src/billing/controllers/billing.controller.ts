import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { RequirePermissions } from '../../auth/decorators';
import { AwsService } from '../../aws/aws.service';
import { OcrService } from '../../ocr/ocr.service';
import { PdfService } from '../../pdf/services/pdf.service';
import { CreateAdditionalChargeDto } from '../dto/create-additional-charge.dto';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { BillingService } from '../services/billing.service';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly pdfService: PdfService,
    private readonly awsService: AwsService,
    private readonly ocrService: OcrService,
  ) {}

  @Post('payment')
  @RequirePermissions('create:payments')
  createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.billingService.createPayment(createPaymentDto);
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
    return this.billingService.findPayments(
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
    const count = await this.billingService.countPendingPayments();
    return { count };
  }

  @Patch('payments/:id/approve')
  @RequirePermissions('update:payments')
  approvePayment(@Param('id') id: string) {
    return this.billingService.approvePayment(id);
  }

  @Patch('payments/:id/reject')
  @RequirePermissions('update:payments')
  rejectPayment(@Param('id') id: string, @Body('reason') reason: string) {
    return this.billingService.rejectPayment(id, reason || 'Rechazado por el administrador');
  }

  @Patch('payments/:id/date')
  @RequirePermissions('update:payments')
  updatePaymentDate(@Param('id') id: string, @Body('paymentDate') paymentDate: string) {
    return this.billingService.updatePaymentDate(id, paymentDate);
  }

  @Patch('invoices/:invoiceId/recalculate')
  @RequirePermissions('update:billing')
  recalculateInvoice(@Param('invoiceId') invoiceId: string) {
    return this.billingService.recalculateInvoiceAmountFromContract(invoiceId);
  }

  @Post('contracts/:contractId/invoices')
  @RequirePermissions('create:billing')
  generateInvoice(
    @Param('contractId') contractId: string,
    @Body('billingMonth') billingMonth?: string,
  ) {
    return this.billingService.generateInvoiceForContract(contractId, billingMonth);
  }

  @Get('invoices/:invoiceId/pdf')
  @RequirePermissions('read:billing')
  async downloadInvoicePdf(
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { pdfBuffer, filename } = await this.billingService.buildInvoicePdf(
      invoiceId,
      this.pdfService,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Post('invoices/:invoiceId/charges')
  @RequirePermissions('create:billing')
  addAdditionalCharge(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CreateAdditionalChargeDto,
  ) {
    return this.billingService.addAdditionalCharge(invoiceId, dto);
  }

  @Delete('invoices/:invoiceId/charges/:lineId')
  @RequirePermissions('update:billing')
  removeAdditionalCharge(@Param('invoiceId') invoiceId: string, @Param('lineId') lineId: string) {
    return this.billingService.removeAdditionalCharge(invoiceId, lineId);
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
    let formattedDate = '';
    if (ocrResult.fecha) {
      const parts = ocrResult.fecha.split('/');
      if (parts.length === 3) {
        formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }

    let mappedMethod = 'PAGO_MOVIL';
    if (ocrResult.moneda === 'USD') {
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

    if (ocrResult.moneda === 'VES') {
      amountBsVal = ocrAmount;
    } else {
      amountUsd = ocrAmount;
    }

    return {
      referenceNumber: ocrResult.referencia || '',
      amount: amountUsd,
      amountBs: amountBsVal,
      paymentDate: formattedDate,
      paymentMethod: mappedMethod,
      bank: ocrResult.nombreBanco || ocrResult.origen || '',
      url: s3Url,
      rawOcr: ocrResult,
    };
  }
}
