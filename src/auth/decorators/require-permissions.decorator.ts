import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Inyecta en los metadatos los permisos requeridos para ejecutar un endpoint.
 * @example
 * @RequirePermissions('create:users', 'read:users')
 * @Post()
 * createUser() { ... }
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
