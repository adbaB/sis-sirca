import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { getQueryRunnerSafe } from '../../common/context/request-context';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { EntityNotFoundException, InvalidDomainOperationException } from '../../common/exceptions';
import { ClonePlanServicesResponseDto } from '../dto/clone-plan-services-response.dto';
import { PlanService } from '../entities/plan-service.entity';
import { Plan } from '../entities/plan.entity';

@Injectable()
export class PlanCloningService {
  constructor(
    @InjectRepository(Plan)
    private readonly plansRepository: Repository<Plan>,
    @InjectRepository(PlanService)
    private readonly planServicesRepository: Repository<PlanService>,
    private readonly dataSource: DataSource,
  ) {}

  private getPlanRepo(): Repository<Plan> {
    const qr = getQueryRunnerSafe();
    if (qr?.manager) {
      return qr.manager.getRepository(Plan);
    }
    return this.plansRepository;
  }

  private getPlanServiceRepo(): Repository<PlanService> {
    const qr = getQueryRunnerSafe();
    if (qr?.manager) {
      return qr.manager.getRepository(PlanService);
    }
    return this.planServicesRepository;
  }

  @Transactional()
  async cloneServices(
    targetPlanId: string,
    sourcePlanId: string,
  ): Promise<ClonePlanServicesResponseDto> {
    if (targetPlanId === sourcePlanId) {
      throw new InvalidDomainOperationException(
        'No se puede clonar los servicios de un plan sobre sí mismo.',
      );
    }

    const planRepo = this.getPlanRepo();
    const planServiceRepo = this.getPlanServiceRepo();

    // Lock target plan row to serialize concurrent clone operations targeting the same plan
    const targetPlan = await planRepo.findOne({
      where: { id: targetPlanId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!targetPlan) {
      throw new EntityNotFoundException('Plan', targetPlanId);
    }

    const sourcePlan = await planRepo.findOne({ where: { id: sourcePlanId } });

    if (!sourcePlan) {
      throw new EntityNotFoundException('Plan', sourcePlanId);
    }

    const sourceServices = await planServiceRepo.find({
      where: { planId: sourcePlanId },
    });

    if (sourceServices.length === 0) {
      return {
        targetPlanId,
        sourcePlanId,
        clonedCount: 0,
        skippedCount: 0,
        clonedServices: [],
      };
    }

    const existingTargetServices = await planServiceRepo.find({
      where: { planId: targetPlanId },
    });
    const existingServiceIds = new Set(
      existingTargetServices.map((service) => service.medicalServiceId),
    );

    const toCreate: PlanService[] = [];
    let skippedCount = 0;

    for (const src of sourceServices) {
      if (existingServiceIds.has(src.medicalServiceId)) {
        skippedCount++;
        continue;
      }

      const newPlanService = planServiceRepo.create({
        planId: targetPlanId,
        medicalServiceId: src.medicalServiceId,
        limitType: src.limitType,
        limitQuantity: src.limitQuantity,
        waitingPeriodDays: src.waitingPeriodDays,
        copayAmount: src.copayAmount,
        copayPercentage: src.copayPercentage,
        cost: src.cost,
        salePrice: src.salePrice,
      });

      toCreate.push(newPlanService);
    }

    const clonedServices = toCreate.length > 0 ? await planServiceRepo.save(toCreate) : [];

    return {
      targetPlanId,
      sourcePlanId,
      clonedCount: clonedServices.length,
      skippedCount,
      clonedServices,
    };
  }
}
