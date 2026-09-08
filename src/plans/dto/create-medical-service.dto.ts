import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
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

  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;
}
