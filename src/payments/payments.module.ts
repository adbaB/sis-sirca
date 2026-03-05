import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { AwsModule } from '../aws/aws.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [AwsModule, EmailModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
