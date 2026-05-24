import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import type { JwtPayload } from './guards';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Valida credenciales y retorna el token JWT junto con los datos públicos
   * del usuario (id, email, rol y permisos planos).
   */
  async login(dto: LoginDto) {
    // 1. Buscar usuario por email
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    // 2. Verificar que el usuario esté activo
    if (!user.isActive) {
      throw new UnauthorizedException('La cuenta del usuario está inactiva.');
    }

    // 3. Comparar contraseña
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    // 4. Generar JWT con payload mínimo (solo userId y roleId)
    const payload: JwtPayload = {
      userId: user.id,
      roleId: user.roleId,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    // 5. Extraer lista plana de permisos desde la BD
    const permissions = user.role?.permissions?.map((p) => p.name) ?? [];

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        isActive: user.isActive,
        advisorId: user.advisorId ?? null,
        role: user.role
          ? {
              id: user.role.id,
              name: user.role.name,
            }
          : null,
        permissions,
      },
    };
  }
}
