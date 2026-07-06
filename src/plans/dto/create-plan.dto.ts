import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
  IsString,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlanStatus } from '../entities/plan.entity';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @IsPositive()
  maxAge: number;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  commissionAmount?: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  coverage: number;

  @IsInt()
  @Min(2)
  @IsOptional()
  @Type(() => Number)
  minMonths?: number = 2;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  minAge?: number = 0;

  @IsEnum(PlanStatus)
  @IsOptional()
  status?: PlanStatus;
}
