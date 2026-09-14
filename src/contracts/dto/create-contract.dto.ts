import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  IsArray,
  MaxLength,
  IsInt,
} from 'class-validator';

export class CreateContractDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legacyCode?: string;
  @IsDateString()
  @IsNotEmpty()
  affiliationDate: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'La fecha de inicio debe tener un formato de fecha válido (YYYY-MM-DD).' },
  )
  startDate?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'La fecha de vencimiento debe tener un formato de fecha válido (YYYY-MM-DD).' },
  )
  expirationDate?: string;

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
  @Max(100)
  advisorCommission?: number;

  @IsOptional()
  @IsBoolean()
  excludeFromNextBilling?: boolean;

  @IsOptional()
  @IsInt({ message: 'El día de corte debe ser un número entero' })
  @Min(1, { message: 'El día de corte no puede ser menor a 1' })
  @Max(31, { message: 'El día de corte no puede ser mayor a 31' })
  cutoffDay?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
