import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { RequirePermissions } from '../auth/decorators';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('create:users')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @RequirePermissions('read:users')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @RequirePermissions('read:users')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('update:users')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('delete:users')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }

  /**
   * Asigna o actualiza el rol de un usuario.
   * PATCH /users/:id/role
   */
  @Patch(':id/role')
  @RequirePermissions('update:users')
  assignRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignRoleDto) {
    return this.usersService.assignRole(id, dto.roleId);
  }
}
