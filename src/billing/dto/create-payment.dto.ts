import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
  @IsOptional()
  invoiceId?: string;

  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  invoiceIds?: string[];

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  amountExtracted?: number;

  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  @IsString()
  @IsNotEmpty()
  referenceNumber: string;

  @IsString()
  @IsOptional()
  datePaymentReceipt?: string;

  @IsString()
  @IsOptional()
  operationDate?: string;

  @IsString()
  @IsOptional()
  url?: string;

  @IsUUID()
  @IsOptional()
  personId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
