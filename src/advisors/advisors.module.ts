import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdvisorsService } from './advisors.service';
import { Advisor } from './entities/advisor.entity';
import { AdvisorsController } from './advisors.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Advisor])],
  controllers: [AdvisorsController],
  providers: [AdvisorsService],
  exports: [AdvisorsService],
})
export class AdvisorsModule {}
