import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import * as Sentry from '@sentry/nestjs';
import { IS_PUBLIC_KEY } from '../decorators';
import { setContextUser } from '../../common/context/request-context';

export interface JwtPayload {
  userId: string;
  roleId: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Verificar si el endpoint es público
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // 2. Extraer el JWT de la cookie
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromCookie(request);

    if (!token) {
      throw new UnauthorizedException('No se encontró token de autenticación.');
    }

    // 3. Verificar firma y vigencia del token
    try {
      const payload: JwtPayload = await this.jwtService.verifyAsync(token);
      // Inyectar el payload en request.user
      request['user'] = payload;
      // Propagar al contexto de ALS y a Sentry
      setContextUser(payload);
      Sentry.setUser({ id: payload.userId, role: payload.roleId });
    } catch {
      throw new UnauthorizedException('Token de autenticación inválido o expirado.');
    }

    return true;
  }

  private extractTokenFromCookie(request: Request): string | undefined {
    return request.cookies?.['access_token'];
  }
}
