import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { HealthCategory } from '../entities/health-declaration.entity';

export class HealthDeclarationDto {
  @IsEnum(HealthCategory)
  @IsNotEmpty()
  category: HealthCategory;

  @IsBoolean()
  @IsNotEmpty()
  hasCondition: boolean;

  @IsString()
  @IsOptional()
  affectedPersons?: string;

  @IsString()
  @IsOptional()
  details?: string;
}
