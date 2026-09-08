import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePlanServiceDto } from './create-plan-service.dto';

export class BatchCreatePlanServicesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePlanServiceDto)
  services: CreatePlanServiceDto[];
}
