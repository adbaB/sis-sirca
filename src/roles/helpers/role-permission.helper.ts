import { EntityManager } from 'typeorm';
import { Role } from '../entities/role.entity';

export async function hasRolePermission(
  roleId: string,
  permissionName: string,
  manager: EntityManager,
): Promise<boolean> {
  const roleRepo = manager.getRepository(Role);
  const role = await roleRepo.findOne({
    where: { id: roleId },
    relations: ['permissions'],
  });
  return Boolean(role?.permissions?.some((p) => p.name === permissionName));
}
