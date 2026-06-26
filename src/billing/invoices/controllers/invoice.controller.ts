import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../auth/decorators';
import { InvoiceService } from '../services/invoice.service';

@Controller('billing/invoices')
export class InvoiceController {
  constructor(private invoiceService: InvoiceService) {}

  @Get('pending')
  @RequirePermissions('create:advisor-payments')
  getPendingInvoices(@Query('identityCard') identityCard: string) {
    if (!identityCard) {
      throw new BadRequestException('El parámetro identityCard es obligatorio.');
    }
    return this.invoiceService.findPendingInvoices(identityCard);
  }

  @Post('/:contractId/generate')
  @RequirePermissions('create:billing')
  generateInvoice(
    @Param('contractId') contractId: string,
    @Body('billingMonth') billingMonth?: string,
  ) {
    return this.invoiceService.generateInvoiceForContract(contractId, billingMonth);
  }
}
