import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { BillingService } from './services/billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

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

  @Post('contracts/:contractId/invoices')
  @RequirePermissions('create:billing')
  generateInvoice(
    @Param('contractId') contractId: string,
    @Body('billingMonth') billingMonth?: string,
  ) {
    return this.billingService.generateInvoiceForContract(contractId, billingMonth);
  }

  @Patch('invoices/:invoiceId/recalculate')
  @RequirePermissions('update:billing')
  recalculateInvoice(@Param('invoiceId') invoiceId: string) {
    return this.billingService.recalculateInvoiceAmountFromContract(invoiceId);
  }
}
