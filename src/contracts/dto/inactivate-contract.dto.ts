import { IsNotEmpty, IsString } from 'class-validator';

export class InactivateContractDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
