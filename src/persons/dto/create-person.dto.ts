import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PersonStatus, TypeIdentityCard } from '../entities/person.entity';
import { PersonRole } from '../../contracts/entities/contract-person.entity';

export class CreatePersonDto {
  @IsEnum(TypeIdentityCard)
  @IsNotEmpty()
  typeIdentityCard: TypeIdentityCard;

  @IsString()
  @IsNotEmpty()
  identityCard: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsBoolean()
  @IsOptional()
  gender?: boolean;

  @IsUUID()
  @IsNotEmpty()
  planId: string;

  @IsUUID()
  @IsOptional()
  contractId?: string;

  @IsEnum(PersonRole)
  @IsOptional()
  role?: PersonRole;

  @IsBoolean()
  @IsOptional()
  isBillingOwner?: boolean;

  @IsEnum(PersonStatus)
  @IsOptional()
  status?: PersonStatus;
}
