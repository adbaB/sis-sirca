import { IsOptional, IsString } from 'class-validator';

export class UploadMedicalReportDto {
  @IsOptional()
  @IsString()
  medicalReportUrl?: string; // URL del PDF subido a S3

  @IsOptional()
  @IsString()
  medicalReportNotes?: string; // Diagnóstico u observaciones del informe
}
