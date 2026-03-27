import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePaymentTypeDto } from './dto/create-payment-type.dto';
import { PaymentType } from './entities/payment-type.entity';

@Injectable()
export class PaymentTypesService {
  constructor(
    @InjectRepository(PaymentType)
    private paymentTypesRepository: Repository<PaymentType>,
  ) {}

  create(createPaymentTypeDto: CreatePaymentTypeDto): Promise<PaymentType> {
    const paymentType = this.paymentTypesRepository.create(createPaymentTypeDto);
    return this.paymentTypesRepository.save(paymentType);
  }

  findAll(): Promise<PaymentType[]> {
    return this.paymentTypesRepository.find();
  }

  async findOne(id: string): Promise<PaymentType> {
    const paymentType = await this.paymentTypesRepository.findOne({ where: { id } });
    if (!paymentType) {
      throw new NotFoundException(`PaymentType #${id} not found`);
    }
    return paymentType;
  }
}
