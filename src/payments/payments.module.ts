import { Module } from '@nestjs/common';
import { AwsModule } from '../aws/aws.module';
import { EmailModule } from '../email/email.module';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AwsModule, EmailModule],
  controllers: [],
  providers: [PaymentsService],
})
export class PaymentsModule {}
