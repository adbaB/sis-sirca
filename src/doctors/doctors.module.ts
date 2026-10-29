import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Doctor } from './entities/doctor.entity';
import { User } from '../users/entities/user.entity';
import { DoctorsService } from './doctors.service';
import { DoctorsController } from './doctors.controller';
import { AwsModule } from '../aws/aws.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Doctor, User]), AwsModule, AuthModule],
  controllers: [DoctorsController],
  providers: [DoctorsService],
  exports: [DoctorsService, TypeOrmModule],
})
export class DoctorsModule {}
