import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignRoleDto {
  @IsUUID('4', { message: 'El roleId debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'El roleId es obligatorio.' })
  roleId: string;
}
