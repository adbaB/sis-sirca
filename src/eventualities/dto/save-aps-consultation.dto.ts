import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ServiceRequestType } from '../entities/eventuality-service-request.entity';

export class TreatmentItemDto {
  @IsNotEmpty({ message: 'El nombre del medicamento es obligatorio.' })
  @IsString()
  medicationName: string;

  @IsOptional()
  @IsString()
  presentation?: string;

  @IsNotEmpty({ message: 'La dosis es obligatoria.' })
  @IsString()
  dosage: string;

  @IsNotEmpty({ message: 'La frecuencia es obligatoria.' })
  @IsString()
  frequency: string;

  @IsNotEmpty({ message: 'La duración es obligatoria.' })
  @IsString()
  duration: string;

  @IsOptional()
  @IsString()
  administrationRoute?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class ServiceRequestItemDto {
  @IsNotEmpty({ message: 'El tipo de solicitud es obligatorio.' })
  @IsIn([
    ServiceRequestType.LABORATORY,
    ServiceRequestType.IMAGING,
    ServiceRequestType.SPECIAL_STUDY,
    ServiceRequestType.CONSULTATION,
    ServiceRequestType.HOSPITALIZATION,
  ])
  requestType: ServiceRequestType;

  @IsOptional()
  @IsUUID('4')
  medicalServiceId?: string;

  @IsNotEmpty({ message: 'El nombre del servicio o estudio es obligatorio.' })
  @IsString()
  serviceName: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  clinicalJustification?: string;

  @IsOptional()
  @IsIn(['NORMAL', 'URGENT'])
  priority?: 'NORMAL' | 'URGENT';
}

export class SaveApsConsultationDto {
  @IsOptional()
  @IsString()
  primaryCie10Code?: string;

  @IsOptional()
  @IsArray()
  secondaryCie10Codes?: Array<{ code: string; description: string }>;

  @IsOptional()
  @IsString()
  reasonForConsultation?: string;

  @IsOptional()
  @IsString()
  currentIllness?: string;

  @IsOptional()
  @IsString()
  physicalExam?: string;

  @IsOptional()
  @IsString()
  medicalReport?: string;

  @IsOptional()
  @IsString()
  admissionDiagnosis?: string;

  @IsOptional()
  @IsString()
  dischargeDiagnosis?: string;

  @IsOptional()
  @IsString()
  generalTreatmentNotes?: string;

  @IsOptional()
  @IsUUID('4')
  doctorId?: string;

  @IsOptional()
  @IsBoolean()
  completeConsultation?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TreatmentItemDto)
  treatmentItems?: TreatmentItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceRequestItemDto)
  serviceRequests?: ServiceRequestItemDto[];
}
