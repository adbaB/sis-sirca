import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class UploadConsumptionSheetDto {
  @IsOptional()
  @IsIn(['APPEND', 'REPLACE'], {
    message: 'El modo de corte debe ser "APPEND" o "REPLACE".',
  })
  readonly mode?: 'APPEND' | 'REPLACE';

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de corte debe ser una fecha válida (YYYY-MM-DD).' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly cutoffDate?: string;
}
