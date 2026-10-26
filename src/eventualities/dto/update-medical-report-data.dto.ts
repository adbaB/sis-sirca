import { IsOptional, IsString } from 'class-validator';

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
}
