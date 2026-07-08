import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  IsNumber,
  Min,
  Max,
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

  @IsString()
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
  @IsOptional()
  weight?: number;

  @IsNumber()
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

export class CreateContractFullDto {
  @IsOptional()
  @IsString()
  legacyCode?: string;

  @IsDateString()
  @IsNotEmpty()
  affiliationDate: string;

  @IsNotEmpty()
  @IsUUID()
  advisorId: string;

  @IsOptional()
  @IsUUID()
  portfolioId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  retentionPercentage?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => AffiliatePersonDto)
  affiliates: AffiliatePersonDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}
