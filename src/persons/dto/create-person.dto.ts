import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { TypeIdentityCard } from '../entities/person.entity';

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
  @IsNotEmpty()
  gender: boolean;

  @IsUUID()
  @IsNotEmpty()
  planId: string;

  @IsUUID()
  @IsOptional()
  contractId?: string;

  @IsEnum(['TITULAR', 'AFILIADO'])
  @IsOptional()
  role?: 'TITULAR' | 'AFILIADO';
}
