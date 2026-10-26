import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AddProviderInvoiceDto {
  @IsString()
  providerName: string;

  @IsOptional()
  @IsString()
  providerRif?: string;

  @IsString()
  invoiceNumber: string;

  @IsOptional()
  @IsString()
  controlNumber?: string;

  @IsDateString()
  invoiceDate: string;

  @IsOptional()
  @IsString()
  invoicePdfUrl?: string;

  @IsNumber()
  @Min(0)
  subtotalAmount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsNumber()
  @Min(0)
  totalAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
