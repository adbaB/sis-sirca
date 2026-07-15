import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
  ValidateNested,
  IsEmail,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PersonStatus, TypeIdentityCard } from '../entities/person.entity';
import { PersonRole, Parentesco } from '../../contracts/entities/contract-person.entity';
import { HealthDeclarationDto } from '../../contracts/dto/health-declaration.dto';

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

  @IsEnum(Parentesco)
  @IsOptional()
  relationship?: Parentesco;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => HealthDeclarationDto)
  healthDeclarations?: HealthDeclarationDto[];
}
