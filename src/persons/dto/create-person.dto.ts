import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { PersonStatus, TypeIdentityCard } from '../entities/person.entity';

export function HasAtLeastOneName(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'hasAtLeastOneName',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as CreatePersonDto;
          const hasName = typeof obj.name === 'string' && obj.name.trim().length > 0;
          const hasFirst = typeof obj.firstName === 'string' && obj.firstName.trim().length > 0;
          const hasLast = typeof obj.lastName === 'string' && obj.lastName.trim().length > 0;
          return hasName || hasFirst || hasLast;
        },
        defaultMessage() {
          return 'Debe proporcionar al menos un nombre (name, firstName o lastName).';
        },
      },
    });
  };
}

export function IsGenderValid(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isGenderValid',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          if (typeof value === 'boolean') return true;
          if (typeof value === 'string') {
            const upper = value.trim().toUpperCase();
            return ['MALE', 'FEMALE', 'M', 'F'].includes(upper);
          }
          return false;
        },
        defaultMessage() {
          return 'El género debe ser booleano (true/false) o uno de los valores válidos: MALE, FEMALE, M, F.';
        },
      },
    });
  };
}

export class CreatePersonDto {
  @IsEnum(TypeIdentityCard)
  @IsNotEmpty()
  typeIdentityCard: TypeIdentityCard;

  @IsString()
  @IsNotEmpty()
  identityCard: string;

  @IsString()
  @IsOptional()
  @HasAtLeastOneName()
  name?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsOptional()
  @IsGenderValid()
  gender?: boolean | string;

  @IsEnum(PersonStatus)
  @IsOptional()
  status?: PersonStatus;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  mobilePhone?: string;

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
}
