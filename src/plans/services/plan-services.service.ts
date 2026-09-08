import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { resolveQueryRunner } from '../../common/context/request-context';
import { Transactional } from '../../common/decorators/transactional.decorator';
import {
  EntityAlreadyExistsException,
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions';
import { BatchCreatePlanServicesDto } from '../dto/batch-create-plan-services.dto';
import { CreatePlanServiceDto } from '../dto/create-plan-service.dto';
import { UpdatePlanServiceDto } from '../dto/update-plan-service.dto';
import { MedicalService } from '../entities/medical-service.entity';
import { PlanService, PlanServiceLimitType } from '../entities/plan-service.entity';
import { Plan } from '../entities/plan.entity';

export interface GroupedCategoryServices {
  category: {
    id: string;
    code: string;
    name: string;
    description?: string | null;
  };
  services: PlanService[];
}

@Injectable()
export class PlanServicesService {
  constructor(
    @InjectRepository(PlanService)
    private readonly planServicesRepository: Repository<PlanService>,
    @InjectRepository(Plan)
    private readonly plansRepository: Repository<Plan>,
    @InjectRepository(MedicalService)
    private readonly medicalServicesRepository: Repository<MedicalService>,
    private readonly dataSource: DataSource,
  ) {}

  private getPlanServiceRepo(): Repository<PlanService> {
    try {
      const qr = resolveQueryRunner(undefined, this.dataSource);
      if (qr?.manager) {
        return qr.manager.getRepository(PlanService);
      }
    } catch {
      // fallback to injected repository
    }
    return this.planServicesRepository;
  }

  private getPlanRepo(): Repository<Plan> {
    try {
      const qr = resolveQueryRunner(undefined, this.dataSource);
      if (qr?.manager) {
        return qr.manager.getRepository(Plan);
      }
    } catch {
      // fallback to injected repository
    }
    return this.plansRepository;
  }

  private getMedicalServiceRepo(): Repository<MedicalService> {
    try {
      const qr = resolveQueryRunner(undefined, this.dataSource);
      if (qr?.manager) {
        return qr.manager.getRepository(MedicalService);
      }
    } catch {
      // fallback to injected repository
    }
    return this.medicalServicesRepository;
  }

  private validateLimits(
    limitType: PlanServiceLimitType,
    limitQuantity?: number | null,
  ): number | null {
    if (limitType === PlanServiceLimitType.UNLIMITED) {
      if (limitQuantity !== undefined && limitQuantity !== null) {
        throw new InvalidDomainOperationException(
          'Para límite tipo UNLIMITED no se debe especificar cantidad (debe ser null).',
        );
      }
      return null;
    }

    if (limitType === PlanServiceLimitType.MONTHLY || limitType === PlanServiceLimitType.ANNUAL) {
      if (limitQuantity === undefined || limitQuantity === null || limitQuantity < 1) {
        throw new InvalidDomainOperationException(
          `Para límite tipo ${limitType} se requiere una cantidad límite mayor o igual a 1.`,
        );
      }
      return limitQuantity;
    }

    throw new InvalidDomainOperationException(`Tipo de límite no soportado: ${limitType}`);
  }

  private async verifyPlanExists(planId: string): Promise<Plan> {
    const plan = await this.getPlanRepo().findOne({ where: { id: planId } });
    if (!plan) {
      throw new EntityNotFoundException('Plan', planId);
    }
    return plan;
  }

  private async verifyMedicalServiceExists(medicalServiceId: string): Promise<MedicalService> {
    const ms = await this.getMedicalServiceRepo().findOne({
      where: { id: medicalServiceId },
    });
    if (!ms) {
      throw new EntityNotFoundException('MedicalService', medicalServiceId);
    }
    return ms;
  }

  async create(planId: string, dto: CreatePlanServiceDto): Promise<PlanService> {
    await this.verifyPlanExists(planId);
    await this.verifyMedicalServiceExists(dto.medicalServiceId);

    const limitQuantity = this.validateLimits(dto.limitType, dto.limitQuantity);

    const existing = await this.getPlanServiceRepo().findOne({
      where: { planId, medicalServiceId: dto.medicalServiceId },
    });

    if (existing) {
      throw new EntityAlreadyExistsException('PlanService', `${planId} - ${dto.medicalServiceId}`);
    }

    const planService = this.getPlanServiceRepo().create({
      planId,
      medicalServiceId: dto.medicalServiceId,
      limitType: dto.limitType,
      limitQuantity,
      waitingPeriodDays: dto.waitingPeriodDays ?? 0,
      copayAmount: dto.copayAmount ?? 0,
      copayPercentage: dto.copayPercentage ?? 0,
    });

    return await this.getPlanServiceRepo().save(planService);
  }

  @Transactional()
  async createBatch(planId: string, dto: BatchCreatePlanServicesDto): Promise<PlanService[]> {
    await this.verifyPlanExists(planId);

    // Check duplicate services within the incoming batch
    const seenServiceIds = new Set<string>();
    for (const item of dto.services) {
      if (seenServiceIds.has(item.medicalServiceId)) {
        throw new InvalidDomainOperationException(
          `El servicio médico "${item.medicalServiceId}" está duplicado en la solicitud por lote.`,
        );
      }
      seenServiceIds.add(item.medicalServiceId);
    }

    // Check existing plan services for this plan
    const existingList = await this.getPlanServiceRepo().find({
      where: { planId },
    });
    const existingSet = new Set(existingList.map((e) => e.medicalServiceId));

    for (const item of dto.services) {
      if (existingSet.has(item.medicalServiceId)) {
        throw new EntityAlreadyExistsException(
          'PlanService',
          `${planId} - ${item.medicalServiceId}`,
        );
      }
    }

    // Verify all medical services exist
    for (const item of dto.services) {
      await this.verifyMedicalServiceExists(item.medicalServiceId);
    }

    // Create and save entities
    const entities = dto.services.map((item) => {
      const limitQuantity = this.validateLimits(item.limitType, item.limitQuantity);
      return this.getPlanServiceRepo().create({
        planId,
        medicalServiceId: item.medicalServiceId,
        limitType: item.limitType,
        limitQuantity,
        waitingPeriodDays: item.waitingPeriodDays ?? 0,
        copayAmount: item.copayAmount ?? 0,
        copayPercentage: item.copayPercentage ?? 0,
      });
    });

    return await this.getPlanServiceRepo().save(entities);
  }

  async findByPlan(
    planId: string,
    grouped = false,
  ): Promise<PlanService[] | GroupedCategoryServices[]> {
    await this.verifyPlanExists(planId);

    const planServices = await this.getPlanServiceRepo().find({
      where: { planId },
      relations: {
        medicalService: {
          category: true,
        },
      },
      order: {
        createdAt: 'ASC',
      },
    });

    if (!grouped) {
      return planServices;
    }

    const categoryMap = new Map<string, GroupedCategoryServices>();

    for (const ps of planServices) {
      const category = ps.medicalService?.category;
      if (!category) {
        continue;
      }

      if (!categoryMap.has(category.id)) {
        categoryMap.set(category.id, {
          category: {
            id: category.id,
            code: category.code,
            name: category.name,
            description: category.description,
          },
          services: [],
        });
      }

      categoryMap.get(category.id)!.services.push(ps);
    }

    return Array.from(categoryMap.values());
  }

  async findOne(planId: string, planServiceId: string): Promise<PlanService> {
    await this.verifyPlanExists(planId);

    const planService = await this.getPlanServiceRepo().findOne({
      where: { id: planServiceId, planId },
      relations: {
        medicalService: {
          category: true,
        },
      },
    });

    if (!planService) {
      throw new EntityNotFoundException('PlanService', planServiceId);
    }

    return planService;
  }

  async update(
    planId: string,
    planServiceId: string,
    dto: UpdatePlanServiceDto,
  ): Promise<PlanService> {
    const planService = await this.findOne(planId, planServiceId);

    const newLimitType = dto.limitType ?? planService.limitType;
    let newLimitQuantity =
      dto.limitQuantity !== undefined ? dto.limitQuantity : planService.limitQuantity;

    if (dto.limitType !== undefined || dto.limitQuantity !== undefined) {
      newLimitQuantity = this.validateLimits(newLimitType, newLimitQuantity);
    }

    if (dto.medicalServiceId && dto.medicalServiceId !== planService.medicalServiceId) {
      await this.verifyMedicalServiceExists(dto.medicalServiceId);
      const existing = await this.getPlanServiceRepo().findOne({
        where: { planId, medicalServiceId: dto.medicalServiceId },
      });
      if (existing && existing.id !== planServiceId) {
        throw new EntityAlreadyExistsException(
          'PlanService',
          `${planId} - ${dto.medicalServiceId}`,
        );
      }
      planService.medicalServiceId = dto.medicalServiceId;
    }

    if (dto.limitType !== undefined) {
      planService.limitType = newLimitType;
    }
    if (dto.limitQuantity !== undefined || dto.limitType !== undefined) {
      planService.limitQuantity = newLimitQuantity;
    }
    if (dto.waitingPeriodDays !== undefined) {
      planService.waitingPeriodDays = dto.waitingPeriodDays;
    }
    if (dto.copayAmount !== undefined) {
      planService.copayAmount = dto.copayAmount;
    }
    if (dto.copayPercentage !== undefined) {
      planService.copayPercentage = dto.copayPercentage;
    }

    return await this.getPlanServiceRepo().save(planService);
  }

  async remove(planId: string, planServiceId: string): Promise<PlanService> {
    const planService = await this.findOne(planId, planServiceId);
    return await this.getPlanServiceRepo().softRemove(planService);
  }
}
