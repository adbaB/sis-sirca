import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AffiliatePersonDto } from './affiliate-person.dto';

export { AffiliatePersonDto };

export class CreateContractFullDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legacyCode?: string;

  @IsDateString()
  @IsNotEmpty()
  affiliationDate: string;

  @IsNotEmpty()
  @IsUUID()
  advisorId: string;

  @IsOptional()
  @IsUUID()
  portfolioId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  retentionPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  advisorCommission?: number;

  @IsOptional()
  @IsBoolean()
  excludeFromNextBilling?: boolean;

  @IsOptional()
  @IsInt({ message: 'El día de corte debe ser un número entero' })
  @Min(1, { message: 'El día de corte no puede ser menor a 1' })
  @Max(31, { message: 'El día de corte no puede ser mayor a 31' })
  cutoffDay?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => AffiliatePersonDto)
  affiliates: AffiliatePersonDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
