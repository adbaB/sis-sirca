import { Module } from '@nestjs/common';
import { AwsService } from './aws.service';
import { FilesController } from './controllers/aws.controller';

@Module({
  controllers: [FilesController],
  providers: [AwsService],
  exports: [AwsService],
})
export class AwsModule {}
