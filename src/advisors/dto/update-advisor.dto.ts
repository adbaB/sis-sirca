import { PartialType } from '@nestjs/mapped-types';
import { CreateAdvisorDto } from './create-advisor.dto';

export class UpdateAdvisorDto extends PartialType(CreateAdvisorDto) {}
