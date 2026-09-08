import { PartialType } from '@nestjs/mapped-types';
import { CreateMedicalServiceDto } from './create-medical-service.dto';

export class UpdateMedicalServiceDto extends PartialType(CreateMedicalServiceDto) {}
