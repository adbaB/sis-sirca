import { IsNotEmpty, IsUUID } from 'class-validator';

export class SetBillingOwnerDto {
  @IsUUID()
  @IsNotEmpty()
  contractPersonId: string;
}
