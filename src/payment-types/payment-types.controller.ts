import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PaymentTypesService } from './payment-types.service';
import { CreatePaymentTypeDto } from './dto/create-payment-type.dto';

@Controller('payment-types')
export class PaymentTypesController {
  constructor(private readonly paymentTypesService: PaymentTypesService) {}

  @Post()
  create(@Body() createPaymentTypeDto: CreatePaymentTypeDto) {
    return this.paymentTypesService.create(createPaymentTypeDto);
  }

  @Get()
  findAll() {
    return this.paymentTypesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentTypesService.findOne(id);
  }
}
