import { IsArray, IsDateString, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateMedicalReportDataDto {
  @IsOptional()
  @IsString()
  reportType?: string | null;

  @IsOptional()
  @IsString()
  company?: string | null;

  @IsOptional()
  @IsString()
  doctorFullName?: string | null;

  @IsOptional()
  @IsString()
  doctorIdentityCard?: string | null;

  @IsOptional()
  @IsString()
  doctorMs?: string | null;

  @IsOptional()
  @IsString()
  doctorComezu?: string | null;

  @IsOptional()
  @IsString()
  doctorSpecialty?: string | null;

  @IsOptional()
  @IsString()
  admissionDiagnosis?: string | null;

  @IsOptional()
  @IsString()
  medicalReport?: string | null;

  @IsOptional()
  @IsString()
  dischargeDiagnosis?: string | null;

  @IsOptional()
  @IsString()
  reportDate?: string | null;

  @IsOptional()
  @IsString()
  reportTime?: string | null;

  @IsOptional()
  @IsString()
  medicalReportNotes?: string | null;

  @IsOptional()
  @IsString()
  primaryCie10Code?: string | null;

  @IsOptional()
  @IsArray()
  secondaryCie10Codes?: Array<{ code: string; description: string }> | null;

  @IsOptional()
  @IsString()
  reasonForConsultation?: string | null;

  @IsOptional()
  @IsString()
  currentIllness?: string | null;

  @IsOptional()
  @IsString()
  physicalExam?: string | null;

  @IsOptional()
  @IsString()
  generalTreatmentNotes?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUUID('all')
  @Transform(({ value }) => (value === '' ? null : value))
  doctorId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsDateString()
  signedAt?: string | null;
}
