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
  ValidateIf,
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

  @ValidateIf((o: AffiliatePersonDto) => !!o.planId || o.birthDate !== undefined)
  @IsNotEmpty({ message: 'La fecha de nacimiento es requerida si tiene un plan asociado.' })
  @IsDateString({}, { message: 'La fecha de nacimiento debe tener un formato de fecha válido.' })
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

  @IsDateString(
    {},
    { message: 'La fecha de afiliación debe tener un formato de fecha válido (YYYY-MM-DD).' },
  )
  @IsOptional()
  affiliationDate?: string;

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

  @ValidateIf((o: AffiliatePersonDto) => !!o.planId || o.weight !== undefined)
  @IsNotEmpty({ message: 'El peso es requerido si tiene un plan asociado.' })
  @IsNumber({}, { message: 'El peso debe ser un número válido.' })
  @Min(0.01, { message: 'El peso debe ser mayor a 0.' })
  weight?: number;

  @ValidateIf((o: AffiliatePersonDto) => !!o.planId || o.height !== undefined)
  @IsNotEmpty({ message: 'La talla es requerida si tiene un plan asociado.' })
  @IsNumber({}, { message: 'La talla debe ser un número válido.' })
  @Min(0.01, { message: 'La talla debe ser mayor a 0.' })
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
