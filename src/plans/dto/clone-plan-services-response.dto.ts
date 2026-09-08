import { PlanService } from '../entities/plan-service.entity';

export class ClonePlanServicesResponseDto {
  targetPlanId: string;
  sourcePlanId: string;
  clonedCount: number;
  skippedCount: number;
  clonedServices: PlanService[];
}
