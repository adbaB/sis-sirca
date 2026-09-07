import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { Contract } from '../../contracts/entities/contract.entity';
import { InvoiceController } from './controllers/invoice.controller';
import { InvoiceBillingController } from './controllers/invoice-billing.controller';
import { InvoiceService } from './services/invoice.service';
import { InvoiceGenerationService } from './services/invoice-generation.service';
import { InvoiceCalculationService } from './services/invoice-calculation.service';
import { InvoiceLineService } from './services/invoice-line.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { InvoiceQueryRepository } from './repositories/invoice-query.repository';
import { ExchangeRateModule } from '../../exchange-rate/exchange-rate.module';
import { PdfModule } from '../../pdf/pdf.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceLine, Contract]),
    ExchangeRateModule,
    PdfModule,
  ],
  controllers: [InvoiceController, InvoiceBillingController],
  providers: [
    InvoiceService,
    InvoiceGenerationService,
    InvoiceCalculationService,
    InvoiceLineService,
    InvoicePdfService,
    InvoiceQueryRepository,
  ],
  exports: [
    InvoiceService,
    InvoiceGenerationService, // Exportado para el cron de generación mensual
    InvoiceCalculationService, // Exportado para que SurplusService lo inyecte directamente
  ],
})
export class InvoiceModule {}
