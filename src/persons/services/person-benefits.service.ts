import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EntityNotFoundException,
  InvalidDomainOperationException,
} from '../../common/exceptions/domain-exceptions';
import { ContractPersonExclusion } from '../../contracts/entities/contract-person-exclusion.entity';
import { ContractPerson } from '../../contracts/entities/contract-person.entity';
import { ContractStatus } from '../../contracts/entities/contract.entity';
import { PlanService } from '../../plans/entities/plan-service.entity';
import {
  BenefitCoverageStatus,
  PersonBenefitItemDto,
  PersonBenefitsResponseDto,
} from '../dto/person-benefits-response.dto';
import { Person } from '../entities/person.entity';

@Injectable()
export class PersonBenefitsService {
  constructor(
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    @InjectRepository(ContractPerson)
    private readonly contractPersonRepo: Repository<ContractPerson>,
    @InjectRepository(PlanService)
    private readonly planServiceRepo: Repository<PlanService>,
    @InjectRepository(ContractPersonExclusion)
    private readonly exclusionRepo: Repository<ContractPersonExclusion>,
  ) {}

  async getPersonBenefits(personId: string): Promise<PersonBenefitsResponseDto> {
    // 1. Validate person existence
    const person = await this.personRepo.findOne({
      where: { id: personId },
    });

    if (!person) {
      throw new EntityNotFoundException('Person', personId);
    }

    // 2. Resolve active ContractPerson & Contract
    const contractPersons = await this.contractPersonRepo.find({
      where: { person: { id: personId } },
      relations: ['contract', 'plan', 'person', 'person.plan'],
    });

    const activeContractPersons = contractPersons.filter(
      (cp) => cp.contract && cp.contract.status === ContractStatus.ACTIVE,
    );

    if (activeContractPersons.length === 0) {
      throw new InvalidDomainOperationException(
        'La persona no posee un contrato activo en el sistema.',
      );
    }

    activeContractPersons.sort((a, b) => {
      const dateA = new Date(a.contract.affiliationDate).getTime();
      const dateB = new Date(b.contract.affiliationDate).getTime();
      if (dateB !== dateA) {
        return dateB - dateA;
      }
      const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return createdB - createdA;
    });

    const activeCp = activeContractPersons[0];
    const activeContract = activeCp.contract;

    // 3. Resolve effective plan
    const effectivePlan = activeCp.plan ?? activeCp.person?.plan;
    if (!effectivePlan) {
      throw new InvalidDomainOperationException(
        'El afiliado no posee un plan de salud asignado en su contrato activo.',
      );
    }

    // 4. Calculate elapsed days from contract.affiliationDate
    const now = new Date();
    const nowDateOnly = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const affDate = new Date(activeContract.affiliationDate);
    const affDateOnly = new Date(
      Date.UTC(affDate.getUTCFullYear(), affDate.getUTCMonth(), affDate.getUTCDate()),
    );
    const diffTime = nowDateOnly.getTime() - affDateOnly.getTime();
    const affiliationDaysElapsed = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

    // 5. Fetch plan services
    const planServices = await this.planServiceRepo.find({
      where: { planId: effectivePlan.id },
      relations: ['medicalService', 'medicalService.category'],
      order: { createdAt: 'ASC' },
    });

    // 6. Fetch active exclusions
    const exclusions = await this.exclusionRepo.find({
      where: { contractPersonId: activeCp.id },
    });

    const excludedServicesMap = new Map<string, ContractPersonExclusion>();
    const excludedCategoriesMap = new Map<string, ContractPersonExclusion>();

    for (const ex of exclusions) {
      if (ex.medicalServiceId) {
        excludedServicesMap.set(ex.medicalServiceId, ex);
      }
      if (ex.serviceCategoryId) {
        excludedCategoriesMap.set(ex.serviceCategoryId, ex);
      }
    }

    // 7. Map and classify each plan service (Tri-State Hierarchy)
    const services: PersonBenefitItemDto[] = planServices.map((ps) => {
      const medicalService = ps.medicalService;
      const category = medicalService?.category;
      const medicalServiceId = ps.medicalServiceId;
      const categoryId = medicalService?.categoryId ?? category?.id;

      let status: BenefitCoverageStatus;
      let isCovered: boolean;
      let exclusionReason: string | null = null;
      let exclusionSource: string | null = null;
      let remainingWaitingPeriodDays: number;
      let effectiveDate: Date | null;

      const serviceExclusion = excludedServicesMap.get(medicalServiceId);
      const categoryExclusion = categoryId ? excludedCategoriesMap.get(categoryId) : undefined;
      const matchingExclusion = serviceExclusion ?? categoryExclusion;

      const waitingPeriodDays = Number(ps.waitingPeriodDays ?? 0);

      // Precedence 1: EXCLUDED
      if (matchingExclusion) {
        status = 'EXCLUDED';
        isCovered = false;
        exclusionReason = matchingExclusion.reason;
        exclusionSource = matchingExclusion.source;
        remainingWaitingPeriodDays = 0;
        effectiveDate = null;
      } else if (affiliationDaysElapsed < waitingPeriodDays) {
        // Precedence 2: WAITING_PERIOD
        status = 'WAITING_PERIOD';
        isCovered = false;
        remainingWaitingPeriodDays = waitingPeriodDays - affiliationDaysElapsed;
        effectiveDate = new Date(affDate.getTime() + waitingPeriodDays * 24 * 60 * 60 * 1000);
      } else {
        // Precedence 3: COVERED
        status = 'COVERED';
        isCovered = true;
        remainingWaitingPeriodDays = 0;
        effectiveDate = affDate;
      }

      return {
        planServiceId: ps.id,
        medicalServiceId,
        medicalServiceCode: medicalService?.code ?? '',
        medicalServiceName: medicalService?.name ?? '',
        serviceCategoryId: categoryId ?? '',
        serviceCategoryName: category?.name ?? '',
        limitType: ps.limitType,
        limitQuantity:
          ps.limitQuantity !== null && ps.limitQuantity !== undefined
            ? Number(ps.limitQuantity)
            : null,
        waitingPeriodDays,
        remainingWaitingPeriodDays,
        copayAmount: Number(ps.copayAmount ?? 0),
        copayPercentage: Number(ps.copayPercentage ?? 0),
        status,
        isCovered,
        exclusionReason,
        exclusionSource,
        effectiveDate,
      };
    });

    // Extract names
    let firstName = '';
    let lastName = '';
    if (
      (person as unknown as { firstName?: string; lastName?: string }).firstName ||
      (person as unknown as { firstName?: string; lastName?: string }).lastName
    ) {
      const pWithNames = person as unknown as { firstName?: string; lastName?: string };
      firstName = pWithNames.firstName ?? '';
      lastName = pWithNames.lastName ?? '';
    } else if (person.name) {
      const parts = person.name.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    return {
      person: {
        id: person.id,
        firstName,
        lastName,
        identityCard: person.identityCard,
        typeIdentityCard: person.typeIdentityCard,
        name: person.name,
      },
      contract: {
        id: activeContract.id,
        code: activeContract.code,
        status: activeContract.status,
        affiliationDate: activeContract.affiliationDate,
      },
      plan: {
        id: effectivePlan.id,
        code: (effectivePlan as unknown as { code?: string }).code ?? effectivePlan.name,
        name: effectivePlan.name,
        description:
          (effectivePlan as unknown as { description?: string }).description ?? undefined,
      },
      affiliationDaysElapsed,
      services,
    };
  }
}
