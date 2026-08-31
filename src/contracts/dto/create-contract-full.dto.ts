import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
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
