import {
  ArrayNotEmpty,
  IsArray,
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

export class CreateFromRequestsDto {
  @IsNotEmpty({ message: 'Debe incluir al menos una solicitud.' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true, message: 'Cada ID de solicitud debe ser un UUID válido.' })
  requestIds: string[];

  @IsNotEmpty({ message: 'El tipo de eventualidad a crear es obligatorio.' })
  @IsIn([EventualityType.STUDY, EventualityType.CONSULTATION, EventualityType.HOSPITALIZATION], {
    message: 'El tipo debe ser STUDY, CONSULTATION o HOSPITALIZATION.',
  })
  type: EventualityType.STUDY | EventualityType.CONSULTATION | EventualityType.HOSPITALIZATION;

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
}
