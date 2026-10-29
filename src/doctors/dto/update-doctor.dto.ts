import { PartialType } from '@nestjs/mapped-types';
import { CreateDoctorDto } from './create-doctor.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateDoctorDto extends PartialType(CreateDoctorDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
