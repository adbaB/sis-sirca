import { IsDateString, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDoctorDto {
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @IsString()
  firstName: string;

  @IsNotEmpty({ message: 'El apellido es obligatorio.' })
  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  typeIdentityCard?: string;

  @IsNotEmpty({ message: 'La cédula de identidad es obligatoria.' })
  @IsString()
  identityCard: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha de egreso debe ser una fecha válida (YYYY-MM-DD).' })
  graduationDate?: string;

  @IsNotEmpty({ message: 'La especialidad es obligatoria.' })
  @IsString()
  specialty: string;

  @IsNotEmpty({ message: 'El número de MPPS es obligatorio.' })
  @IsString()
  mpps: string;

  @IsOptional()
  @IsString()
  comezu?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico debe ser válido.' })
  email?: string;

  @IsOptional()
  @IsString()
  digitalSignatureUrl?: string;

  @IsOptional()
  @IsUUID('4', { message: 'El ID de usuario debe ser un UUID válido.' })
  userId?: string;
}
