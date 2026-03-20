import { IsDateString, IsNotEmpty } from 'class-validator';

export class CreateContractDto {
  @IsDateString()
  @IsNotEmpty()
  affiliationDate: string;

  @IsNotEmpty()
  code: string;
}
