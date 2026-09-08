import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MedicalServicesController } from './controllers/medical-services.controller';
import { PlansController } from './controllers/plans.controller';
import { ServiceCategoriesController } from './controllers/service-categories.controller';
import { MedicalService } from './entities/medical-service.entity';
import { PlanService } from './entities/plan-service.entity';
import { Plan } from './entities/plan.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { MedicalServicesService } from './services/medical-services.service';
import { PlanCloningService } from './services/plan-cloning.service';
import { PlanServicesService } from './services/plan-services.service';
import { PlansService } from './services/plans.service';
import { ServiceCategoriesService } from './services/service-categories.service';

@Module({
  imports: [TypeOrmModule.forFeature([Plan, ServiceCategory, MedicalService, PlanService])],
  controllers: [PlansController, ServiceCategoriesController, MedicalServicesController],
  providers: [
    PlansService,
    ServiceCategoriesService,
    MedicalServicesService,
    PlanServicesService,
    PlanCloningService,
  ],
  exports: [
    PlansService,
    ServiceCategoriesService,
    MedicalServicesService,
    PlanServicesService,
    TypeOrmModule,
  ],
})
export class PlansModule {}
