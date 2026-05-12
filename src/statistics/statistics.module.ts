import { Module } from '@nestjs/common';
import { StatisticsService } from './services/statistics.service';
import { StatisticsController } from './controllers/statistics.controller';

@Module({
  providers: [StatisticsService],
  exports: [StatisticsService],
  controllers: [StatisticsController],
})
export class StatisticsModule {}
