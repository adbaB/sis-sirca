import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaymentOrigin } from '../entities/payment.entity';

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

  @IsEnum(PaymentOrigin)
  @IsOptional()
  origin?: PaymentOrigin;

  @IsString()
  @IsOptional()
  url?: string;

  @IsUUID()
  @IsOptional()
  personId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
