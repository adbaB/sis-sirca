import { PartialType } from '@nestjs/mapped-types';
import { CreatePlanServiceDto } from './create-plan-service.dto';

export class UpdatePlanServiceDto extends PartialType(CreatePlanServiceDto) {}
