import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAdvisorDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsBoolean()
  @IsOptional()
  status?: boolean;
}
