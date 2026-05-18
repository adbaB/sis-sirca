import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { UsersModule } from '../users/users.module';
import { Role } from '../roles/entities/role.entity';
import config from '../config/configurations';
import { ConfigType } from '@nestjs/config';
import type { StringValue } from 'ms';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([Role]), // Para PermissionsGuard
    JwtModule.registerAsync({
      inject: [config.KEY],
      useFactory: (configService: ConfigType<typeof config>) => ({
        secret: configService.jwt.secret,
        signOptions: {
          expiresIn: configService.jwt.expiresIn as StringValue,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Registrar AuthGuard como guard global
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // Registrar PermissionsGuard como guard global (se ejecuta después de AuthGuard)
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
