import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cie10Code } from './entities/cie10-code.entity';
import { Cie10Service } from './cie10.service';
import { Cie10Controller } from './cie10.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Cie10Code]), AuthModule],
  controllers: [Cie10Controller],
  providers: [Cie10Service],
  exports: [Cie10Service, TypeOrmModule],
})
export class Cie10Module {}
