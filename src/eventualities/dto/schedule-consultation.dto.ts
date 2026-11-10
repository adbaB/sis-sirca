import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class ScheduleConsultationDto {
  @IsNotEmpty({ message: 'El ID de la persona es obligatorio.' })
  @IsUUID('4', { message: 'El ID de la persona debe ser un UUID válido.' })
  readonly personId: string;

  @IsNotEmpty({ message: 'El ID de la afiliación contractual es obligatorio.' })
  @IsUUID('4', { message: 'El ID de la afiliación debe ser un UUID válido.' })
  readonly contractPersonId: string;

  @IsNotEmpty({ message: 'Debe seleccionar el médico para agendar la consulta.' })
  @IsUUID('4', { message: 'El ID del médico debe ser un UUID válido.' })
  readonly doctorId: string;

  @IsNotEmpty({ message: 'La fecha y hora de la cita son obligatorias.' })
  @IsDateString({}, { message: 'La fecha y hora de la cita deben ser ISO 8601 válidas.' })
  readonly scheduledAt: string;

  @IsOptional()
  @IsUUID('4')
  readonly medicalServiceId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly clinicName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  readonly estimatedCost?: number;

  @IsOptional()
  @IsUUID('4')
  readonly parentEventualityId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  readonly serviceRequestIds?: string[];
}

export class RescheduleConsultationDto {
  @IsNotEmpty({ message: 'La nueva fecha y hora de la cita son obligatorias.' })
  @IsDateString({}, { message: 'La fecha y hora deben estar en formato ISO 8601.' })
  readonly scheduledAt: string;

  @IsOptional()
  @IsUUID('4')
  readonly doctorId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly notes?: string;
}

export class CancelConsultationDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly reason?: string;
}

export class FindDoctorConsultationsCalendarDto {
  @IsOptional()
  @IsString()
  readonly startDate?: string;

  @IsOptional()
  @IsString()
  readonly endDate?: string;

  @IsOptional()
  @IsUUID('4')
  readonly doctorId?: string;
}
