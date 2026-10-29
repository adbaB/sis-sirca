import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateUserDto {
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio.' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres.' })
  password: string;

  @IsUUID('all', { message: 'El roleId debe ser un UUID válido.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
  @Transform(({ value }) => (value === '' ? null : value))
  roleId?: string;

  @IsUUID('all', { message: 'El advisorId debe ser un UUID válido.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
  @Transform(({ value }) => (value === '' ? null : value))
  advisorId?: string | null;

  @IsUUID('all', { message: 'El doctorId debe ser un UUID válido.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
  @Transform(({ value }) => (value === '' ? null : value))
  doctorId?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
