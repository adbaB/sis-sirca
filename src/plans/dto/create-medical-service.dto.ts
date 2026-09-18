import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HealthCategory } from '../../contracts/entities/health-declaration.entity';

export class CreateMedicalServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  @IsArray()
  @IsEnum(HealthCategory, { each: true })
  @IsOptional()
  linkedHealthCategories?: HealthCategory[] = [];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salePrice?: number | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;
}
