import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentTypesService } from './payment-types.service';
import { PaymentType } from './entities/payment-type.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentType])],
  controllers: [],
  providers: [PaymentTypesService],
})
export class PaymentTypesModule {}
