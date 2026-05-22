import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { BillingService } from './services/billing.service';

@Public()
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('payment')
  createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.billingService.createPayment(createPaymentDto);
  }

  @Get('payments')
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
  async getPendingCount() {
    const count = await this.billingService.countPendingPayments();
    return { count };
  }

  @Patch('payments/:id/approve')
  approvePayment(@Param('id') id: string) {
    return this.billingService.approvePayment(id);
  }

  @Patch('payments/:id/reject')
  rejectPayment(@Param('id') id: string, @Body('reason') reason: string) {
    return this.billingService.rejectPayment(id, reason || 'Rechazado por el administrador');
  }
}
