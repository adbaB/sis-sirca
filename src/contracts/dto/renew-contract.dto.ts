import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BulkUpdateBeneficiaryItemDto } from './bulk-update-beneficiaries.dto';

/**
 * DTO para la renovación de un contrato.
 * Permite establecer la nueva fecha de inicio (startDate) y opcionalmente fecha de vencimiento (expirationDate)
 * para el período de vigencia renovado, preservando intacta la fecha de creación original (affiliationDate).
 * Además, permite actualizar los datos de los pacientes/afiliados/titular (peso, talla, dirección, etc.).
 */
export class RenewContractDto {
  @IsDateString(
    {},
    { message: 'La fecha de inicio debe tener un formato de fecha válido (YYYY-MM-DD).' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de inicio debe tener formato YYYY-MM-DD.',
  })
  @IsNotEmpty({ message: 'La fecha de inicio de la renovación es obligatoria.' })
  startDate: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'La fecha de vencimiento debe tener un formato de fecha válido (YYYY-MM-DD).' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de vencimiento debe tener formato YYYY-MM-DD.',
  })
  expirationDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateBeneficiaryItemDto)
  beneficiaries?: BulkUpdateBeneficiaryItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateBeneficiaryItemDto)
  affiliates?: BulkUpdateBeneficiaryItemDto[];
}
