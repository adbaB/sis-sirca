import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlansService } from './services/plans.service';
import { Plan } from './entities/plan.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Plan])],
  controllers: [],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
