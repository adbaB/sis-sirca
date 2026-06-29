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
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonRole } from '../entities/contract-person.entity';

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
}

export class CreateContractFullDto {
  @IsDateString()
  @IsNotEmpty()
  affiliationDate: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsUUID()
  advisorId?: string;

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
}
