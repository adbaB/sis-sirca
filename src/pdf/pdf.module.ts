import { Module } from '@nestjs/common';
import { PdfService } from './services/pdf.service';

@Module({
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
