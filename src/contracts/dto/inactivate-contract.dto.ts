import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class InactivateContractDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
