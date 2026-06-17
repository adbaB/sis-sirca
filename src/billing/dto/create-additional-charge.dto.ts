import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { InvoiceLineCategory } from '../enums/invoice-line-category.enum';

export class CreateAdditionalChargeDto {
  @IsEnum(InvoiceLineCategory)
  @IsNotEmpty()
  category: InvoiceLineCategory;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsUUID()
  @IsOptional()
  personId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
