import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import { RequirePermissions } from '../../../auth/decorators';
import { InvoiceService } from '../services/invoice.service';
import type { Response } from 'express';
import { PdfService } from '../../../pdf/services/pdf.service';
import { CreateAdditionalChargeDto } from '../dto/create-additional-charge.dto';

@Controller('billing')
export class InvoiceBillingController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly pdfService: PdfService,
  ) {}

  @Patch('invoices/:invoiceId/recalculate')
  @RequirePermissions('update:billing')
  recalculateInvoice(@Param('invoiceId') invoiceId: string) {
    return this.invoiceService.recalculateInvoiceAmountFromContract(invoiceId);
  }

  @Post('contracts/:contractId/invoices')
  @RequirePermissions('create:billing')
  generateInvoice(
    @Param('contractId') contractId: string,
    @Body('billingMonth') billingMonth?: string,
  ) {
    return this.invoiceService.generateInvoiceForContract(contractId, billingMonth);
  }

  @Get('invoices/:invoiceId/pdf')
  @RequirePermissions('read:billing')
  async downloadInvoicePdf(
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { pdfBuffer, filename } = await this.invoiceService.buildInvoicePdf(
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
    return this.invoiceService.addAdditionalCharge(invoiceId, dto);
  }

  @Delete('invoices/:invoiceId/charges/:lineId')
  @RequirePermissions('update:billing')
  removeAdditionalCharge(@Param('invoiceId') invoiceId: string, @Param('lineId') lineId: string) {
    return this.invoiceService.removeAdditionalCharge(invoiceId, lineId);
  }
}
