import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configurations from './configurations';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configurations],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),
  ],
  exports: [ConfigModule],
})
export class EnvConfigModule {}
