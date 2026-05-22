import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../roles/entities/role.entity';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import type { JwtPayload } from './auth.guard';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Si el endpoint es público, no verificar permisos
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Leer los permisos requeridos del decorador @RequirePermissions()
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si no se definieron permisos específicos, solo se requiere autenticación
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    // Obtener el usuario del request (inyectado por AuthGuard)
    const request = context.switchToHttp().getRequest();
    const user = request['user'] as JwtPayload;

    if (!user?.roleId) {
      throw new ForbiddenException('El usuario no tiene un rol asignado.');
    }

    // Buscar los permisos reales del rol en base de datos
    const role = await this.roleRepository.findOne({
      where: { id: user.roleId },
      relations: ['permissions'],
    });

    if (!role) {
      throw new ForbiddenException('El rol del usuario no existe.');
    }

    const userPermissionNames = role.permissions.map((p) => p.name);

    // Verificar que el usuario tenga AL MENOS UNO de los permisos requeridos
    const hasAllPermissions = requiredPermissions.some((required) =>
      userPermissionNames.includes(required),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException('No tiene permisos suficientes para acceder a este recurso.');
    }

    return true;
  }
}
