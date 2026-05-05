import { Module } from '@nestjs/common';
import { AwsModule } from '../aws/aws.module';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AwsModule],
  controllers: [],
  providers: [PaymentsService],
})
export class PaymentsModule {}
