import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { paginateRepository } from '../common/utils/pagination.util';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  async create(dto: CreatePermissionDto): Promise<Permission> {
    const existing = await this.permissionRepository.findOneBy({
      name: dto.name,
    });
    if (existing) {
      throw new ConflictException(`Ya existe un permiso con el nombre "${dto.name}".`);
    }

    const permission = this.permissionRepository.create(dto);
    return this.permissionRepository.save(permission);
  }

  findAll(paginationQuery: PaginationQueryDto): Promise<PaginatedResult<Permission>> {
    return paginateRepository(
      this.permissionRepository,
      { order: { name: 'ASC' } },
      paginationQuery,
    );
  }

  async findOne(id: string): Promise<Permission> {
    const permission = await this.permissionRepository.findOneBy({ id });
    if (!permission) {
      throw new NotFoundException(`Permiso con ID "${id}" no encontrado.`);
    }
    return permission;
  }

  async findByIds(ids: string[]): Promise<Permission[]> {
    return this.permissionRepository.findByIds(ids);
  }

  async update(id: string, dto: UpdatePermissionDto): Promise<Permission> {
    const permission = await this.findOne(id);

    if (dto.name && dto.name !== permission.name) {
      const existing = await this.permissionRepository.findOneBy({
        name: dto.name,
      });
      if (existing) {
        throw new ConflictException(`Ya existe un permiso con el nombre "${dto.name}".`);
      }
    }

    this.permissionRepository.merge(permission, dto);
    return this.permissionRepository.save(permission);
  }

  async remove(id: string): Promise<Permission> {
    const permission = await this.findOne(id);
    return this.permissionRepository.remove(permission);
  }
}
