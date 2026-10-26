import { IsOptional, IsString } from 'class-validator';

export class RejectEventualityDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
