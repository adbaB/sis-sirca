import { Controller, Post, Body, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/login
   * Valida credenciales, genera JWT y lo envía como cookie HttpOnly.
   * El body de respuesta contiene los datos públicos del usuario.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const { accessToken, user } = await this.authService.login(dto);

    // Enviar JWT como cookie HttpOnly, Secure, SameSite=Strict
    response.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000, // 8 horas
      path: '/',
    });

    return { user };
  }

  /**
   * POST /auth/logout
   * Elimina la cookie de autenticación.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return { message: 'Sesión cerrada exitosamente.' };
  }
}
