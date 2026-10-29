import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { EventualityType } from '../entities/eventuality.entity';

export class CreateGeneralEventualityDto {
  @IsNotEmpty({ message: 'El ID de la persona es obligatorio.' })
  @IsUUID('4', { message: 'El ID de la persona debe ser un UUID válido.' })
  personId: string;

  @IsNotEmpty({ message: 'El ID de la afiliación contractual es obligatorio.' })
  @IsUUID('4', { message: 'El ID de la afiliación debe ser un UUID válido.' })
  contractPersonId: string;

  @IsNotEmpty({ message: 'El tipo de eventualidad es obligatorio.' })
  @IsIn(
    [
      EventualityType.EMERGENCY,
      EventualityType.HOSPITALIZATION,
      EventualityType.APS,
      EventualityType.CONSULTATION,
      EventualityType.STUDY,
    ],
    { message: 'Tipo de eventualidad no válido.' },
  )
  type: EventualityType;

  @IsOptional()
  @IsString()
  clinicName?: string;

  @IsOptional()
  @IsUUID('4', { message: 'El ID del médico debe ser un UUID válido.' })
  doctorId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de admisión debe ser una cadena ISO 8601 válida.' })
  admissionDate?: string;

  @IsOptional()
  @IsNumber({}, { message: 'El costo estimado debe ser un número.' })
  @Min(0, { message: 'El costo estimado no puede ser negativo.' })
  estimatedCost?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID('4', { message: 'El ID de la eventualidad padre debe ser un UUID válido.' })
  parentEventualityId?: string;
}
