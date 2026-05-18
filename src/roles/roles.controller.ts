import { Controller, Get, Post, Put, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { RequirePermissions } from '../auth/decorators';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @RequirePermissions('create:roles')
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Get()
  @RequirePermissions('read:roles')
  findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @RequirePermissions('read:roles')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('update:roles')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('delete:roles')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.remove(id);
  }

  /**
   * Reemplaza todos los permisos de un rol con los proporcionados.
   * PUT /roles/:id/permissions
   */
  @Put(':id/permissions')
  @RequirePermissions('update:roles')
  assignPermissions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignPermissionsDto) {
    return this.rolesService.assignPermissions(id, dto.permissionIds);
  }
}
