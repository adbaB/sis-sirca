import './instrument';

process.env.TZ = 'America/Caracas';

import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';

import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import { useContainer } from 'class-validator';
import cookieParser from 'cookie-parser';

import config from './config/configurations';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      forbidNonWhitelisted: true,
      whitelist: true,
    }),
  );

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  app.enableCors({
    credentials: true,
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'sentry-trace', 'baggage'],
  });

  const appConfig = app.get<ConfigType<typeof config>>(config.KEY);
  await app.listen(appConfig.server.port ?? 3000);
  app.get(PinoLogger).log(`Application is running on: ${await app.getUrl()}`, 'Bootstrap');
}
bootstrap();
