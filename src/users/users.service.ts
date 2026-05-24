import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '../roles/entities/role.entity';

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.userRepository.findOneBy({ email: dto.email });
    if (existing) {
      throw new ConflictException(`Ya existe un usuario con el correo "${dto.email}".`);
    }

    if (dto.roleId) {
      const role = await this.roleRepository.findOneBy({ id: dto.roleId });
      if (!role) {
        throw new NotFoundException(`Rol con ID "${dto.roleId}" no encontrado.`);
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = this.userRepository.create({
      ...dto,
      password: hashedPassword,
    });

    return this.userRepository.save(user);
  }

  findAll(): Promise<User[]> {
    return this.userRepository.find({
      relations: ['role', 'role.permissions', 'advisor'],
      order: { email: 'ASC' },
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['role', 'role.permissions', 'advisor'],
    });
    if (!user) {
      throw new NotFoundException(`Usuario con ID "${id}" no encontrado.`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: ['role', 'role.permissions', 'advisor'],
    });
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (dto.email && dto.email !== user.email) {
      const existing = await this.userRepository.findOneBy({
        email: dto.email,
      });
      if (existing) {
        throw new ConflictException(`Ya existe un usuario con el correo "${dto.email}".`);
      }
    }

    if (dto.roleId) {
      const role = await this.roleRepository.findOneBy({ id: dto.roleId });
      if (!role) {
        throw new NotFoundException(`Rol con ID "${dto.roleId}" no encontrado.`);
      }
    }

    this.userRepository.merge(user, dto);
    return this.userRepository.save(user);
  }

  async remove(id: string): Promise<User> {
    const user = await this.findOne(id);
    return this.userRepository.remove(user);
  }

  /**
   * Asigna o actualiza el rol de un usuario.
   */
  async assignRole(userId: string, roleId: string): Promise<User> {
    const user = await this.findOne(userId);

    const role = await this.roleRepository.findOneBy({ id: roleId });
    if (!role) {
      throw new NotFoundException(`Rol con ID "${roleId}" no encontrado.`);
    }

    user.roleId = roleId;
    return this.userRepository.save(user);
  }
}
