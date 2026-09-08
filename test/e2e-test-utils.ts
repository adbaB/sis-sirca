import { Server } from 'http';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AuthGuard, PermissionsGuard } from '../src/auth/guards';
import { HealthCategory } from '../src/contracts/entities/health-declaration.entity';

export { HealthCategory };

export enum PlanServiceLimitType {
  UNLIMITED = 'UNLIMITED',
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
}

export enum ExclusionSource {
  AUTOMATIC = 'AUTOMATIC',
  MANUAL = 'MANUAL',
}

export interface E2eTestContext {
  app: INestApplication;
  httpServer: Server;
}

/**
 * Bootstraps a real NestJS application instance configured identically to main.ts,
 * with AuthGuard and PermissionsGuard overridden to provide deterministic security simulation.
 */
export async function createE2eTestApp(): Promise<E2eTestContext> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(AuthGuard)
    .useValue({
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        if (req.headers['x-simulate-unauthorized'] === 'true') {
          throw new UnauthorizedException('No se encontró token de autenticación.');
        }
        // Injects an authenticated admin user context
        req.user = {
          userId: '00000000-0000-0000-0000-000000000001',
          roleId: '00000000-0000-0000-0000-000000000002',
        };
        return true;
      },
    })
    .overrideGuard(PermissionsGuard)
    .useValue({
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        if (req.headers['x-simulate-forbidden'] === 'true') {
          throw new ForbiddenException(
            'No tiene permisos suficientes para acceder a este recurso.',
          );
        }
        return true;
      },
    })
    .compile();

  const app = moduleFixture.createNestApplication();

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      forbidNonWhitelisted: true,
      whitelist: true,
    }),
  );

  await app.init();
  const httpServer = app.getHttpServer();

  return { app, httpServer };
}

/**
 * Safely tears down the test application and database connections.
 */
export async function closeE2eTestApp(app?: INestApplication): Promise<void> {
  if (app) {
    await app.close();
  }
}

/**
 * Generates an isolated, collision-free code for entities across test executions.
 */
export function generateUniqueCode(prefix = 'TEST'): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}_${timestamp}_${random}`;
}
