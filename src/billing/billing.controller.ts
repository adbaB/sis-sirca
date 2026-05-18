import { Controller, Post, Body } from '@nestjs/common';
import { BillingService } from './services/billing.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { Public } from '../auth/decorators';

@Public()
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('payment')
  createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.billingService.createPayment(createPaymentDto);
  }
}
