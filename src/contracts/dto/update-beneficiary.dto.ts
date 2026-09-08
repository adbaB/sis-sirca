import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { Parentesco } from '../entities/contract-person.entity';
import { HealthDeclarationDto } from './health-declaration.dto';
import { CreateContractPersonExclusionDto } from './create-contract-person-exclusion.dto';

export class UpdateBeneficiaryDto {
  // Datos de Persona (opcionales)
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(TypeIdentityCard)
  @IsOptional()
  typeIdentityCard?: TypeIdentityCard;

  @IsString()
  @IsOptional()
  identityCard?: string;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsBoolean()
  @IsOptional()
  gender?: boolean;

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

  // Datos de la relación en el Contrato (opcionales)
  @IsUUID()
  @IsOptional()
  planId?: string;

  @IsEnum(Parentesco)
  @IsOptional()
  relationship?: Parentesco;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => HealthDeclarationDto)
  healthDeclarations?: HealthDeclarationDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateContractPersonExclusionDto)
  exclusions?: CreateContractPersonExclusionDto[];
}
