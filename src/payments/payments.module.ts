import { Module } from '@nestjs/common';
import { AwsModule } from '../aws/aws.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [AwsModule, BillingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
