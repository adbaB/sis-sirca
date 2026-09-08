import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ContractPersonExclusion } from '../entities/contract-person-exclusion.entity';
import { ContractPerson } from '../entities/contract-person.entity';
import { ExclusionSource } from '../entities/exclusion-source.enum';
import { HEALTH_CATEGORIES_METADATA } from '../constants/health-categories.constants';
import { HealthDeclarationDto } from '../dto/health-declaration.dto';
import { CreateContractPersonExclusionDto } from '../dto/create-contract-person-exclusion.dto';
import {
  EvaluateHealthExclusionsDto,
  EvaluatedExclusionItem,
  HealthExclusionEvaluationResult,
} from '../dto/evaluate-health-exclusions.dto';
import { MedicalServicesService } from '../../plans/services/medical-services.service';
import { PlanServicesService } from '../../plans/services/plan-services.service';
import { PlanService } from '../../plans/entities/plan-service.entity';
import { InvalidDomainOperationException } from '../../common/exceptions';

@Injectable()
export class HealthExclusionsService {
  private readonly logger = new Logger(HealthExclusionsService.name);

  constructor(
    @InjectRepository(ContractPersonExclusion)
    private readonly exclusionRepo: Repository<ContractPersonExclusion>,
    private readonly medicalServicesService: MedicalServicesService,
    private readonly planServicesService: PlanServicesService,
  ) {}

  /**
   * Pre-evaluates health declarations and returns suggested exclusions,
   * respecting any manual overrides provided by the advisor.
   */
  async evaluateHealthExclusions(
    dto: EvaluateHealthExclusionsDto,
  ): Promise<HealthExclusionEvaluationResult> {
    const { healthDeclarations = [], manualExclusions = [], planId } = dto;

    // 1. Identify declared conditions (hasCondition === true)
    const activeDeclarations = healthDeclarations.filter((d) => d.hasCondition === true);
    const declaredCategories = Array.from(new Set(activeDeclarations.map((d) => d.category)));

    // 2. Fetch medical services linked to declared categories
    const matchingServices =
      declaredCategories.length > 0
        ? await this.medicalServicesService.findByHealthCategories(declaredCategories)
        : [];

    // 3. If planId is provided, collect medical service IDs covered by the plan
    let planServiceIds: Set<string> | null = null;
    if (planId) {
      const planServices = (await this.planServicesService.findByPlan(planId)) as PlanService[];
      planServiceIds = new Set(planServices.map((ps) => ps.medicalServiceId));
    }

    // 4. Map matching services to suggested automatic exclusions (deduplicating by medicalServiceId)
    const suggestedMap = new Map<string, EvaluatedExclusionItem>();

    for (const service of matchingServices) {
      const matchingDecls = activeDeclarations.filter(
        (decl) =>
          service.linkedHealthCategories && service.linkedHealthCategories.includes(decl.category),
      );
      if (matchingDecls.length === 0) continue;

      const firstDecl = matchingDecls[0];
      const catMeta = HEALTH_CATEGORIES_METADATA.find((m) => m.category === firstDecl.category);
      const categoryTitle = catMeta?.title || firstDecl.category;

      let reason: string;
      if (matchingDecls.length > 1) {
        const parts = matchingDecls.map((d) => {
          const m = HEALTH_CATEGORIES_METADATA.find((meta) => meta.category === d.category);
          const title = m?.title || d.category;
          return d.details ? `${title} [${d.category}] (${d.details})` : `${title} [${d.category}]`;
        });
        reason = `Exclusión médica por patología declarada: ${parts.join('; ')}`;
      } else if (firstDecl.details) {
        reason = `Exclusión médica por patología declarada: ${firstDecl.category} - ${categoryTitle} (${firstDecl.details})`;
      } else {
        reason = `Exclusión médica por patología declarada: ${firstDecl.category} - ${categoryTitle}`;
      }

      suggestedMap.set(service.id, {
        medicalServiceId: service.id,
        medicalServiceCode: service.code,
        medicalServiceName: service.name,
        serviceCategoryId: service.categoryId,
        serviceCategoryName: service.category?.name,
        healthCategory: firstDecl.category,
        reason,
        source: ExclusionSource.AUTOMATIC,
        isManualOverride: false,
        inPlan: planServiceIds ? planServiceIds.has(service.id) : undefined,
      });
    }

    const suggestedExclusions = Array.from(suggestedMap.values());

    // 5. Process manual modifications
    const manualExclusionItems: EvaluatedExclusionItem[] = [];
    const manualServiceIdSet = new Set<string>();

    for (const manual of manualExclusions) {
      if (manual.medicalServiceId) {
        manualServiceIdSet.add(manual.medicalServiceId);
      }

      const suggested = manual.medicalServiceId ? suggestedMap.get(manual.medicalServiceId) : null;

      manualExclusionItems.push({
        medicalServiceId: manual.medicalServiceId || null,
        medicalServiceCode: suggested?.medicalServiceCode,
        medicalServiceName: suggested?.medicalServiceName,
        serviceCategoryId: manual.serviceCategoryId || suggested?.serviceCategoryId || null,
        serviceCategoryName: suggested?.serviceCategoryName,
        healthCategory: suggested?.healthCategory,
        reason: manual.reason,
        source: ExclusionSource.MANUAL,
        isManualOverride: true,
        inPlan:
          manual.medicalServiceId && planServiceIds
            ? planServiceIds.has(manual.medicalServiceId)
            : undefined,
      });
    }

    // 6. Build unified list: manual overrides replace automatic suggestions
    const allExclusions: EvaluatedExclusionItem[] = [];

    // Add suggested items that were NOT overridden by a manual entry
    for (const suggested of suggestedExclusions) {
      if (!suggested.medicalServiceId || !manualServiceIdSet.has(suggested.medicalServiceId)) {
        allExclusions.push(suggested);
      }
    }

    // Add all manual entries
    allExclusions.push(...manualExclusionItems);

    return {
      suggestedExclusions,
      manualExclusions: manualExclusionItems,
      allExclusions,
      summary: {
        totalConditionsDeclared: activeDeclarations.length,
        totalServicesExcluded: allExclusions.length,
        hasManualModifications: manualExclusionItems.length > 0,
      },
    };
  }

  /**
   * Detects and persists exclusions for a ContractPerson within a transaction.
   * If explicit exclusions are provided, persists those directly (empty array [] means waived).
   * Otherwise, auto-detects from declared health conditions.
   */
  async detectAndPersistExclusions(
    contractPerson: ContractPerson,
    declarations: HealthDeclarationDto[],
    explicitExclusions?: CreateContractPersonExclusionDto[],
    manager?: EntityManager,
  ): Promise<ContractPersonExclusion[]> {
    const repo = manager ? manager.getRepository(ContractPersonExclusion) : this.exclusionRepo;

    // Case 1: Explicit exclusions provided (reviewed or customized by advisor)
    if (explicitExclusions !== undefined) {
      return this.saveExclusionList(contractPerson, explicitExclusions, repo);
    }

    // Case 2: Auto-detect from health declarations
    const activeDecls = (declarations || []).filter((d) => d.hasCondition === true);
    if (activeDecls.length === 0) {
      return [];
    }

    const evaluation = await this.evaluateHealthExclusions({
      healthDeclarations: declarations,
    });

    const toPersist: CreateContractPersonExclusionDto[] = evaluation.suggestedExclusions.map(
      (item) => ({
        medicalServiceId: item.medicalServiceId || undefined,
        serviceCategoryId: item.serviceCategoryId || undefined,
        reason: item.reason,
        source: ExclusionSource.AUTOMATIC,
      }),
    );

    return this.saveExclusionList(contractPerson, toPersist, repo);
  }

  /**
   * Replaces all active exclusions for a ContractPerson.
   */
  async replaceExclusions(
    contractPerson: ContractPerson,
    exclusions: CreateContractPersonExclusionDto[],
    manager?: EntityManager,
  ): Promise<ContractPersonExclusion[]> {
    const repo = manager ? manager.getRepository(ContractPersonExclusion) : this.exclusionRepo;

    await repo.delete({ contractPersonId: contractPerson.id });
    return this.saveExclusionList(contractPerson, exclusions, repo);
  }

  /**
   * Re-synchronizes automatic exclusions while preserving existing manual exclusions.
   */
  async resyncAutomaticExclusions(
    contractPerson: ContractPerson,
    newDeclarations: HealthDeclarationDto[],
    manager?: EntityManager,
  ): Promise<ContractPersonExclusion[]> {
    const repo = manager ? manager.getRepository(ContractPersonExclusion) : this.exclusionRepo;

    // 1. Delete existing AUTOMATIC exclusions
    await repo.delete({
      contractPersonId: contractPerson.id,
      source: ExclusionSource.AUTOMATIC,
    });

    // 2. Load existing MANUAL exclusions to prevent duplication
    const existingManual = await repo.find({
      where: {
        contractPersonId: contractPerson.id,
        source: ExclusionSource.MANUAL,
      },
    });
    const manualServiceIds = new Set(
      existingManual.map((e) => e.medicalServiceId).filter(Boolean) as string[],
    );
    const manualCategoryIds = new Set(
      existingManual.map((e) => e.serviceCategoryId).filter(Boolean) as string[],
    );

    // 3. Evaluate new declarations
    const activeDecls = (newDeclarations || []).filter((d) => d.hasCondition === true);
    if (activeDecls.length === 0) {
      return existingManual;
    }

    const evaluation = await this.evaluateHealthExclusions({
      healthDeclarations: newDeclarations,
    });

    // 4. Save new automatic exclusions that do not collide with existing manual ones
    const newAutoExclusions = evaluation.suggestedExclusions
      .filter((item) => {
        if (item.medicalServiceId && manualServiceIds.has(item.medicalServiceId)) {
          return false;
        }
        if (
          !item.medicalServiceId &&
          item.serviceCategoryId &&
          manualCategoryIds.has(item.serviceCategoryId)
        ) {
          return false;
        }
        return true;
      })
      .map((item) => ({
        medicalServiceId: item.medicalServiceId || undefined,
        serviceCategoryId: item.serviceCategoryId || undefined,
        reason: item.reason,
        source: ExclusionSource.AUTOMATIC,
      }));

    const savedNew = await this.saveExclusionList(contractPerson, newAutoExclusions, repo);
    return [...existingManual, ...savedNew];
  }

  /**
   * Queries all active exclusions for a ContractPerson with relations.
   */
  async findByContractPerson(
    contractPersonId: string,
    manager?: EntityManager,
  ): Promise<ContractPersonExclusion[]> {
    const repo = manager ? manager.getRepository(ContractPersonExclusion) : this.exclusionRepo;

    return repo.find({
      where: { contractPersonId },
      relations: ['medicalService', 'serviceCategory'],
      order: { createdAt: 'ASC' },
    });
  }

  private async saveExclusionList(
    contractPerson: ContractPerson,
    dtoList: CreateContractPersonExclusionDto[],
    repo: Repository<ContractPersonExclusion>,
  ): Promise<ContractPersonExclusion[]> {
    if (!dtoList || dtoList.length === 0) return [];

    const entities: ContractPersonExclusion[] = [];
    const seen = new Set<string>();

    for (const item of dtoList) {
      if (!item.medicalServiceId && !item.serviceCategoryId) {
        throw new InvalidDomainOperationException(
          'Cada exclusión médica debe especificar un servicio médico o una categoría.',
        );
      }

      // Deduplicate within the same batch
      const dedupeKey = `${item.medicalServiceId || ''}:${item.serviceCategoryId || ''}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      entities.push(
        repo.create({
          contractPerson,
          contractPersonId: contractPerson.id,
          medicalServiceId: item.medicalServiceId || null,
          serviceCategoryId: item.serviceCategoryId || null,
          reason: item.reason,
          source: item.source || ExclusionSource.MANUAL,
        }),
      );
    }

    if (entities.length === 0) return [];
    return repo.save(entities);
  }
}
