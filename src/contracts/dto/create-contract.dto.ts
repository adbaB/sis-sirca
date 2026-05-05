import { IsDateString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateContractDto {
  @IsDateString()
  @IsNotEmpty()
  affiliationDate: string;

  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsUUID()
  advisorId?: string;
}
