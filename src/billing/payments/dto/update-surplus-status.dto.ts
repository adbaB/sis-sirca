import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SurplusStatus } from '../entities/surplus.entity';

/**
 * Objeto de transferencia de datos (DTO) para la modificación manual del estado de un excedente.
 */
export class UpdateSurplusStatusDto {
  /**
   * Nuevo estado destino del excedente.
   * Sólo se permiten estados válidos ('pending', 'refunded', 'cancelled').
   */
  @IsEnum(SurplusStatus, {
    message: 'El estado debe ser uno de los siguientes: pending, refunded, cancelled',
  })
  @IsNotEmpty({ message: 'El estado es requerido' })
  status: SurplusStatus;

  /**
   * Motivo, justificación o referencia del cambio de estado (e.g. referencia de transferencia para reembolso).
   */
  @IsOptional()
  @IsString({ message: 'El motivo debe ser una cadena de texto' })
  @MaxLength(500, { message: 'El motivo no puede exceder los 500 caracteres' })
  reason?: string;
}
