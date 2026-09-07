import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AffiliationStatsMode } from '../interfaces/affiliation-stats.interface';

export class GetAffiliationStatsDto {
  @Type(() => Number)
  @IsInt({ message: 'El parámetro month debe ser un número entero.' })
  @Min(1, { message: 'El parámetro month debe ser un número entre 1 y 12.' })
  @Max(12, { message: 'El parámetro month debe ser un número entre 1 y 12.' })
  month: number;

  @Type(() => Number)
  @IsInt({ message: 'El parámetro year debe ser un número entero.' })
  @Min(1900, { message: 'El parámetro year debe ser un año válido a partir de 1900.' })
  @Max(2100, { message: 'El parámetro year debe ser un año válido hasta 2100.' })
  year: number;

  @IsOptional()
  @IsEnum(['billing', 'calendar'], {
    message: 'El parámetro mode debe ser "billing" o "calendar".',
  })
  mode?: AffiliationStatsMode = 'billing';
}
