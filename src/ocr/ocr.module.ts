import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OcrService } from './ocr.service';

@Module({
  imports: [ConfigModule],
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
