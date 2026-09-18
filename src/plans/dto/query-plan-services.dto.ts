import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryPlanServicesDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  grouped?: boolean = false;
}
