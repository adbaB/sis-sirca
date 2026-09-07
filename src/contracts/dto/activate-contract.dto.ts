import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO para la reactivación de un contrato.
 * Contiene el motivo/justificación opcional para reactivaciones estándar,
 * pero obligatorio cuando se ejecuta un bypass de excepción (por rol autorizado).
 */
export class ActivateContractDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
