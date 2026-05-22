import { IsNotEmpty, IsUUID } from 'class-validator';

export class SetContractTitularDto {
  @IsUUID()
  @IsNotEmpty()
  contractPersonId: string;
}
