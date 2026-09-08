import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlanServiceLimitType } from '../entities/plan-service.entity';

export class CreatePlanServiceDto {
  @IsUUID()
  @IsNotEmpty()
  medicalServiceId: string;

  @IsEnum(PlanServiceLimitType)
  @IsNotEmpty()
  limitType: PlanServiceLimitType;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limitQuantity?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  waitingPeriodDays?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  copayAmount?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  copayPercentage?: number = 0;
}
