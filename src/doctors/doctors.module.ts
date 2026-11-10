import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Doctor } from './entities/doctor.entity';
import { Eventuality } from '../eventualities/entities/eventuality.entity';
import { User } from '../users/entities/user.entity';
import { DoctorsService } from './doctors.service';
import { DoctorScheduleService } from './services/doctor-schedule.service';
import { DoctorsController } from './doctors.controller';
import { AwsModule } from '../aws/aws.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Doctor, Eventuality, User]), AwsModule, AuthModule],
  controllers: [DoctorsController],
  providers: [DoctorsService, DoctorScheduleService],
  exports: [DoctorsService, DoctorScheduleService, TypeOrmModule],
})
export class DoctorsModule {}
