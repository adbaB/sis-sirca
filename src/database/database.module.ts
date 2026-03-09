import { Global, Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import config from '../config/configurations';
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [config.KEY],
      useFactory: (configService: ConfigType<typeof config>) => {
        const { host, port, database, username, password } = configService.db;
        return {
          type: 'postgres',
          host,
          port,
          username,
          password,
          database,
          subscribers: [__dirname + '/../**/**/*.subscriber{.ts,.js}'],
          entities: [__dirname + '/../**/**/*.entity{.ts,.js}'],
          logging: configService.env === 'development' ? false : false,
        };
      },
    }),
  ],
  providers: [],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
