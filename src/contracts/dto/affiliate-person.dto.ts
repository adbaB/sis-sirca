import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { PersonRole, Parentesco } from '../entities/contract-person.entity';
import { HealthDeclarationDto } from './health-declaration.dto';
import { TypeIdentityCard } from '../../persons/entities/person.entity';

export class AffiliatePersonDto {
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

  /** Obligatorio para AFILIADO, ignorado para TITULAR */
  @IsUUID()
  @IsOptional()
  planId?: string;

  @IsEnum(PersonRole)
  @IsNotEmpty()
  role: PersonRole;

  @IsBoolean()
  @IsOptional()
  isBillingOwner?: boolean;

  @IsEnum(Parentesco)
  @IsOptional()
  relationship?: Parentesco;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  alternatePhone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  postalCode?: string;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  weight?: number;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  height?: number;

  @IsString()
  @IsOptional()
  occupation?: string;

  @IsString()
  @IsOptional()
  legalRepresentative?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => HealthDeclarationDto)
  healthDeclarations?: HealthDeclarationDto[];
}
