import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ExclusionSource } from '../entities/exclusion-source.enum';

export class CreateContractPersonExclusionDto {
  @IsOptional()
  @IsUUID()
  medicalServiceId?: string;

  @IsOptional()
  @IsUUID()
  serviceCategoryId?: string;

  @IsString()
  @IsNotEmpty({ message: 'El motivo de exclusión es obligatorio' })
  reason: string;

  @IsOptional()
  @IsEnum(ExclusionSource)
  source?: ExclusionSource = ExclusionSource.MANUAL;
}
