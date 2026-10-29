import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateEmergencyDto {
  @IsUUID()
  personId: string;

  @IsUUID()
  contractPersonId: string;

  @IsString()
  clinicName: string;

  @IsOptional()
  @IsDateString()
  admissionDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedCost?: number; // Monto estimado para bloqueo preventivo de cobertura

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  admissionReason?: string; // Motivo o razón por la cual ingresó el paciente

  @IsOptional()
  @IsUUID()
  parentEventualityId?: string;
}
