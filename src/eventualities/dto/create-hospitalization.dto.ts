import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateHospitalizationDto {
  @IsNotEmpty({ message: 'El ID de la persona es obligatorio.' })
  @IsUUID('4', { message: 'El ID de la persona debe ser un UUID válido.' })
  readonly personId: string;

  @IsNotEmpty({ message: 'El ID de la afiliación contractual es obligatorio.' })
  @IsUUID('4', { message: 'El ID de la afiliación debe ser un UUID válido.' })
  readonly contractPersonId: string;

  @IsNotEmpty({ message: 'El nombre de la clínica prestadora es obligatorio.' })
  @IsString({ message: 'El nombre de la clínica debe ser una cadena.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly clinicName: string;

  @IsNotEmpty({ message: 'El motivo de ingreso a hospitalización es obligatorio.' })
  @IsString({ message: 'El motivo de ingreso debe ser una cadena.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly admissionReason: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de admisión debe ser una fecha ISO válida.' })
  readonly admissionDate?: string;

  @IsOptional()
  @IsUUID('4', { message: 'El ID del médico tratante debe ser un UUID válido.' })
  readonly doctorId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'El ID de la eventualidad padre debe ser un UUID válido.' })
  readonly parentEventualityId?: string;

  @IsOptional()
  @IsArray({ message: 'Los IDs de solicitudes deben ser una lista.' })
  @IsUUID('4', { each: true, message: 'Cada ID de solicitud debe ser un UUID válido.' })
  readonly serviceRequestIds?: string[];

  @IsOptional()
  @IsString({ message: 'Las notas deben ser una cadena.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly notes?: string;
}
