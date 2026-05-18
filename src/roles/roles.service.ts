import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  async create(dto: CreateRoleDto): Promise<Role> {
    const existing = await this.roleRepository.findOneBy({ name: dto.name });
    if (existing) {
      throw new ConflictException(`Ya existe un rol con el nombre "${dto.name}".`);
    }

    const role = this.roleRepository.create(dto);
    return this.roleRepository.save(role);
  }

  findAll(): Promise<Role[]> {
    return this.roleRepository.find({
      relations: ['permissions'],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { id },
      relations: ['permissions'],
    });
    if (!role) {
      throw new NotFoundException(`Rol con ID "${id}" no encontrado.`);
    }
    return role;
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.findOne(id);

    if (dto.name && dto.name !== role.name) {
      const existing = await this.roleRepository.findOneBy({ name: dto.name });
      if (existing) {
        throw new ConflictException(`Ya existe un rol con el nombre "${dto.name}".`);
      }
    }

    this.roleRepository.merge(role, dto);
    return this.roleRepository.save(role);
  }

  async remove(id: string): Promise<Role> {
    const role = await this.findOne(id);
    return this.roleRepository.remove(role);
  }

  /**
   * Reemplaza completamente los permisos de un rol.
   * Los permisos anteriores son eliminados y reemplazados por los nuevos.
   */
  async assignPermissions(roleId: string, permissionIds: string[]): Promise<Role> {
    const role = await this.findOne(roleId);

    const permissions = await this.permissionRepository.findBy({
      id: In(permissionIds),
    });

    if (permissions.length !== permissionIds.length) {
      const foundIds = permissions.map((p) => p.id);
      const notFoundIds = permissionIds.filter((id) => !foundIds.includes(id));
      throw new NotFoundException(
        `Los siguientes permisos no fueron encontrados: ${notFoundIds.join(', ')}`,
      );
    }

    // Reemplazar todos los permisos del rol
    role.permissions = permissions;
    return this.roleRepository.save(role);
  }
}
