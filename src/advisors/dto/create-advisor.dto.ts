import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateAdvisorDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsBoolean()
  @IsOptional()
  status?: boolean;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  commission?: number;
}
