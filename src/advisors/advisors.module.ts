import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdvisorsService } from './advisors.service';
import { Advisor } from './entities/advisor.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Advisor])],
  controllers: [],
  providers: [AdvisorsService],
  exports: [AdvisorsService],
})
export class AdvisorsModule {}
