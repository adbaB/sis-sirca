import { IsBoolean, IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonRole } from '../entities/contract-person.entity';

export class CreateBeneficiaryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(TypeIdentityCard)
  @IsNotEmpty()
  typeIdentityCard: TypeIdentityCard;

  @IsString()
  @IsNotEmpty()
  identityCard: string;

  @IsUUID()
  @IsNotEmpty()
  planId: string;

  @IsEnum(PersonRole)
  @IsNotEmpty()
  role: PersonRole;

  @IsBoolean()
  @IsNotEmpty()
  isBillingOwner: boolean;

  @IsUUID()
  @IsNotEmpty()
  contractId: string;
}
