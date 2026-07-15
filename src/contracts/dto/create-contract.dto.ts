import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  IsArray,
  MaxLength,
} from 'class-validator';

export class CreateContractDto {
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
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
