import { IsOptional, IsString, IsUUID } from 'class-validator';

export class GetPipelineStatsDto {
  @IsOptional()
  @IsUUID('4', { message: 'El advisorId debe ser un UUID válido.' })
  advisorId?: string;

  @IsOptional()
  @IsString()
  month?: string;

  @IsOptional()
  @IsString()
  year?: string;
}
