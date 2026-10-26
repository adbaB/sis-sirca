import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ConsumptionCategory,
  ExtractionStatus,
} from '../entities/eventuality-extraction-detail.entity';

export class UpdateExtractionItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  itemName: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCostBs?: number | null;

  @IsEnum(ConsumptionCategory)
  category: ConsumptionCategory;

  @IsOptional()
  @IsEnum(ExtractionStatus)
  status?: ExtractionStatus;
}

export class UpdateExtractionDetailsDto {
  @IsOptional()
  @IsDateString()
  exchangeRateDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateExtractionItemDto)
  items: UpdateExtractionItemDto[];
}

export class RecalculateConsumptionRateDto {
  @IsDateString()
  exchangeRateDate: string;
}
