import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class GetPipelineStatsDto {
  @IsOptional()
  @IsUUID('4', { message: 'El advisorId debe ser un UUID válido.' })
  advisorId?: string;

  @ValidateIf((o) => o.month !== undefined || o.year !== undefined)
  @IsNotEmpty({ message: 'El parámetro month es obligatorio cuando se especifica un período.' })
  @Type(() => Number)
  @IsInt({ message: 'El parámetro month debe ser un número entero.' })
  @Min(1, { message: 'El parámetro month debe ser un número entre 1 y 12.' })
  @Max(12, { message: 'El parámetro month debe ser un número entre 1 y 12.' })
  month?: number;

  @ValidateIf((o) => o.month !== undefined || o.year !== undefined)
  @IsNotEmpty({ message: 'El parámetro year es obligatorio cuando se especifica un período.' })
  @Type(() => Number)
  @IsInt({ message: 'El parámetro year debe ser un número entero.' })
  @Min(1900, { message: 'El parámetro year debe ser un año válido a partir de 1900.' })
  @Max(2100, { message: 'El parámetro year debe ser un año válido hasta 2100.' })
  year?: number;
}
