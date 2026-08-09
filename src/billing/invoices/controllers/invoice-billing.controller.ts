import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import { RequirePermissions } from '../../../auth/decorators';
import { InvoiceService } from '../services/invoice.service';
import { InvoicePdfService } from '../services/invoice-pdf.service';
import type { Response } from 'express';
import { CreateAdditionalChargeDto } from '../dto/create-additional-charge.dto';
import { AddInvoiceLineInput } from '../dto/add-invoice-line.input';

@Controller('billing')
export class InvoiceBillingController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly invoicePdfService: InvoicePdfService,
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
    const { pdfBuffer, filename } = await this.invoicePdfService.buildInvoicePdf(invoiceId);
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
    // El @IsEnum del DTO garantiza en runtime que category nunca es MENSUALIDAD.
    // El cast es necesario para alinear InvoiceLineCategory con Exclude<..., MENSUALIDAD>.
    return this.invoiceService.addAdditionalCharge(invoiceId, dto as AddInvoiceLineInput);
  }

  @Delete('invoices/:invoiceId/charges/:lineId')
  @RequirePermissions('update:billing')
  removeAdditionalCharge(@Param('invoiceId') invoiceId: string, @Param('lineId') lineId: string) {
    return this.invoiceService.removeAdditionalCharge(invoiceId, lineId);
  }
}
