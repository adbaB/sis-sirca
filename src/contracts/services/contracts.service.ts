import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AffiliationHistory } from '../entities/affiliation-history.entity';

import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { paginateQueryBuilder } from '../../common/utils/pagination.util';
import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { CreateContractDto } from '../dto/create-contract.dto';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { FindContractDto } from '../dto/find-contract.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract, ContractStatus } from '../entities/contract.entity';
import { AffiliationAction } from '../enums/affiliation-action.enum';
import { Advisor } from '../../advisors/entities/advisor.entity';
import { Portfolio } from '../../portfolios/entities/portfolio.entity';
import { BillingService } from '../../billing/services/billing.service';
import { PlansService } from '../../plans/services/plans.service';
import { Plan } from '../../plans/entities/plan.entity';

export interface PipelineTotals {
  totalPipeline: number;
  totalCollected: number;
  totalPending: number;
}

export interface PipelineCounts {
  pending: number;
  rejected: number;
  partial: number;
  paid: number;
}

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private contractsRepository: Repository<Contract>,
    @InjectRepository(ContractPerson)
    private contractPersonsRepository: Repository<ContractPerson>,
    @InjectRepository(AffiliationHistory)
    private affiliationHistoryRepository: Repository<AffiliationHistory>,
    @Inject(forwardRef(() => PersonsService))
    private personsService: PersonsService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
    private plansService: PlansService,
  ) {}

  async create(createContractDto: CreateContractDto): Promise<Contract> {
    const existingContract = await this.contractsRepository.findOne({
      where: { code: createContractDto.code },
    });
    if (existingContract) {
      throw new BadRequestException(
        `El código de contrato "${createContractDto.code}" ya está registrado.`,
      );
    }

    const { advisorId, portfolioId, ...rest } = createContractDto;
    const contract = this.contractsRepository.create({
      ...rest,
      ...(advisorId ? { advisor: { id: advisorId } } : {}),
      ...(portfolioId ? { portfolio: { id: portfolioId } } : {}),
    });
    return this.contractsRepository.save(contract);
  }

  /**
   * Creates a contract with all its affiliated persons in a single transactional operation.
   *
   * Validations:
   * - Contract code must not be duplicated
   * - At most one TITULAR (optional — a contract can have only AFILIADOs)
   * - At most one isBillingOwner (defaults to TITULAR if present and none specified)
   * - AFILIADOs must have a planId
   * - If a person's document already exists as AFILIADO in another active contract → rejected
   */
  async createFull(dto: CreateContractFullDto): Promise<Contract> {
    const existingContract = await this.contractsRepository.findOne({
      where: { code: dto.code },
    });
    if (existingContract) {
      throw new BadRequestException(`El código de contrato "${dto.code}" ya está registrado.`);
    }

    const { advisorId, portfolioId, affiliates, ...contractData } = dto;

    // ── 1. Validate TITULAR count (optional, but at most one) ──────────────
    const titulars = affiliates.filter((a) => a.role === PersonRole.TITULAR);
    if (titulars.length > 1) {
      throw new BadRequestException('Solo puede haber un TITULAR por contrato.');
    }

    // ── 2. Validate billing owner count ────────────────────────────────────
    const billingOwners = affiliates.filter((a) => a.isBillingOwner === true);
    if (billingOwners.length > 1) {
      throw new BadRequestException('Solo puede haber un responsable de facturación por contrato.');
    }

    // If no billing owner specified, default to TITULAR (if present)
    const hasBillingOwner = billingOwners.length === 1;

    // ── 3. Validate AFILIADO planId ────────────────────────────────────────
    for (const affiliate of affiliates) {
      if (affiliate.role === PersonRole.AFILIADO && !affiliate.planId) {
        throw new BadRequestException(
          `El afiliado ${affiliate.name} (${affiliate.typeIdentityCard}-${affiliate.identityCard}) debe tener un plan asignado.`,
        );
      }
    }

    // ── 4. Execute within a transaction ────────────────────────────────────
    return this.contractsRepository.manager.transaction(async (manager) => {
      const personRepo = manager.getRepository(Person);
      const contractRepo = manager.getRepository(Contract);
      const cpRepo = manager.getRepository(ContractPerson);
      const historyRepo = manager.getRepository(AffiliationHistory);

      // ── 4.1. Create the contract ──────────────────────────────────────
      const contract = contractRepo.create({
        ...contractData,
        ...(advisorId ? { advisor: { id: advisorId } } : {}),
        ...(portfolioId ? { portfolio: { id: portfolioId } } : {}),
      });
      const savedContract = await contractRepo.save(contract);

      // ── 4.2. Process each affiliate ───────────────────────────────────
      for (const affiliate of affiliates) {
        const {
          typeIdentityCard,
          identityCard,
          name,
          birthDate,
          gender,
          planId,
          role,
          isBillingOwner,
        } = affiliate;

        // Resolve plan for AFILIADO
        let plan: Plan | null = null;
        if (role === PersonRole.AFILIADO && planId) {
          plan = await this.plansService.findOne(planId);
        }

        // Check if person already exists by document (lock row for updates to avoid race conditions)
        // NOTE: We must NOT load relations alongside pessimistic_write because
        // PostgreSQL forbids FOR UPDATE on the nullable side of a LEFT JOIN.
        let person = await personRepo.findOne({
          where: { identityCard, typeIdentityCard },
          lock: { mode: 'pessimistic_write' },
        });

        // Now load the full person with relations (the row is already locked)
        if (person) {
          person = await personRepo.findOne({
            where: { id: person.id },
            relations: ['plan', 'contractPersons', 'contractPersons.contract'],
          });
        }

        let affiliationReason: string | null = null;

        if (person) {
          // Person exists → validate single-contract rule (cannot be an AFILIADO in another ACTIVE contract)
          if (role === PersonRole.AFILIADO) {
            const activeAffiliations = await cpRepo.find({
              where: {
                person: { id: person.id },
                role: PersonRole.AFILIADO,
                contract: { status: ContractStatus.ACTIVE },
              },
              relations: ['contract'],
            });

            if (activeAffiliations.length > 0) {
              const contractCodes = activeAffiliations.map((cp) => cp.contract.code).join(', ');
              throw new BadRequestException(
                `El afiliado ${person.name} (${person.typeIdentityCard}-${person.identityCard}) ya es beneficiario activo en el contrato: ${contractCodes}. Debe ser desafiliado primero antes de asignarlo a otro contrato.`,
              );
            }
          }

          // Check if person belongs to an INACTIVE contract → CAMBIO_CONTRATO & softRemove from it
          const inactiveAffiliations = await cpRepo.find({
            where: {
              person: { id: person.id },
              contract: { status: ContractStatus.INACTIVE },
            },
            relations: ['contract', 'person', 'person.plan'],
          });

          for (const oldCp of inactiveAffiliations) {
            // Record CAMBIO_CONTRATO in old contract history
            await historyRepo.save(
              historyRepo.create({
                contract: oldCp.contract,
                person,
                plan: oldCp.person?.plan ?? null,
                action: AffiliationAction.CAMBIO_CONTRATO,
                amount: Number(oldCp.person?.plan?.amount ?? 0),
                reason: `Migrado al contrato ${savedContract.code}`,
              }),
            );

            // Soft-delete old ContractPerson so the person is no longer in the old contract
            await cpRepo.softRemove(oldCp);
          }

          if (inactiveAffiliations.length > 0) {
            const oldCodes = inactiveAffiliations.map((cp) => cp.contract.code).join(', ');
            affiliationReason = `Proveniente del contrato ${oldCodes}`;
          }

          // Update person details
          person.name = name;
          if (birthDate) {
            person.birthDate = new Date(birthDate);
          }
          if (gender !== undefined) {
            person.gender = gender;
          }

          // Only update the plan if they are an AFILIADO in the new contract
          if (role === PersonRole.AFILIADO) {
            person.plan = plan;
          }

          person = await personRepo.save(person);
        } else {
          // Person does not exist → create new
          person = personRepo.create({
            typeIdentityCard,
            identityCard,
            name,
            birthDate: birthDate ? new Date(birthDate) : undefined,
            gender,
            plan,
          });
          person = await personRepo.save(person);
        }

        // ── 4.3. Create ContractPerson junction ─────────────────────────
        const resolvedIsBillingOwner = hasBillingOwner
          ? (isBillingOwner ?? false)
          : role === PersonRole.TITULAR; // default: TITULAR is billing owner

        const contractPerson = cpRepo.create({
          contract: savedContract,
          person,
          role,
          isBillingOwner: resolvedIsBillingOwner,
        });
        await cpRepo.save(contractPerson);

        // ── 4.4. Record affiliation history for AFILIADOs ───────────────
        if (role === PersonRole.AFILIADO) {
          await historyRepo.save(
            historyRepo.create({
              contract: savedContract,
              person,
              plan,
              action: AffiliationAction.AFILIACION,
              amount: Number(plan?.amount ?? 0),
              reason: affiliationReason,
            }),
          );
        }
      }

      // ── 4.5. Recalculate monthly amount ─────────────────────────────────
      await this.recalculateMonthlyAmount(savedContract.id, manager);

      // ── 4.6. Return contract with relations loaded ──────────────────────
      return contractRepo.findOne({
        where: { id: savedContract.id },
        relations: [
          'contractPersons',
          'contractPersons.person',
          'contractPersons.person.plan',
          'advisor',
          'portfolio',
        ],
      });
    });
  }

  async inactivate(contractId: string, dto: InactivateContractDto): Promise<Contract> {
    const contract = await this.findOne(contractId);

    if (contract.status === ContractStatus.INACTIVE) {
      throw new BadRequestException('El contrato ya se encuentra inactivo.');
    }

    return this.contractsRepository.manager.transaction(async (manager) => {
      const contractRepo = manager.getRepository(Contract);
      const cpRepo = manager.getRepository(ContractPerson);
      const historyRepo = manager.getRepository(AffiliationHistory);

      // Lock contract for update to guarantee idempotency and avoid race conditions
      const lockedContract = await contractRepo.findOne({
        where: { id: contractId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedContract) {
        throw new NotFoundException(`El contrato con ID "${contractId}" no fue encontrado.`);
      }

      if (lockedContract.status === ContractStatus.INACTIVE) {
        throw new BadRequestException('El contrato ya se encuentra inactivo.');
      }

      // Update contract status and reason
      lockedContract.status = ContractStatus.INACTIVE;
      lockedContract.inactivationReason = dto.reason;
      await contractRepo.save(lockedContract);

      // Record DESAFILIACION for each active person (only AFILIADOs, to avoid counting TITULARs as desafiliations)
      const activePersons = await cpRepo.find({
        where: {
          contract: { id: contractId },
          role: PersonRole.AFILIADO,
        },
        relations: ['person', 'person.plan'],
      });

      // Truncate to match AffiliationHistory.reason max length (255)
      const truncatedReason = dto.reason ? dto.reason.substring(0, 255) : null;

      for (const cp of activePersons) {
        await historyRepo.save(
          historyRepo.create({
            contract: lockedContract,
            person: cp.person,
            plan: cp.person?.plan ?? null,
            action: AffiliationAction.DESAFILIACION,
            amount: Number(cp.person?.plan?.amount ?? 0),
            reason: truncatedReason,
          }),
        );
      }

      return lockedContract;
    });
  }

  async findAll(query: FindContractDto): Promise<PaginatedResult<Contract>> {
    const queryBuilder = this.contractsRepository.createQueryBuilder('contract');
    const targetBillingMonth = this.buildTargetBillingMonth(query);

    this.applyRelations(queryBuilder);
    this.applySearchFilter(queryBuilder, query.search);
    this.applyAdvisorFilter(queryBuilder, query.advisorId);
    if (query.stage || targetBillingMonth) {
      this.applyInvoiceJoins(queryBuilder, targetBillingMonth);
      this.applyStageFilter(queryBuilder, query.stage, targetBillingMonth);
    }

    if (query.stage) {
      queryBuilder.andWhere("contract.status = 'ACTIVE'");
    } else if (query.status) {
      queryBuilder.andWhere('contract.status = :status', { status: query.status });
    }

    queryBuilder.orderBy('contract.code', 'ASC');

    return paginateQueryBuilder(queryBuilder, query);
  }

  // ---------------------------------------------------------------------------
  // findAll — private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds the `YYYY-MM` billing month string when both month and year are present.
   */
  private buildTargetBillingMonth(query: FindContractDto): string | undefined {
    if (query.month && query.year) {
      return `${query.year}-${String(query.month).padStart(2, '0')}`;
    }
    return undefined;
  }

  /**
   * Joins the base relations needed for listing contracts.
   */
  private applyRelations(qb: SelectQueryBuilder<Contract>): void {
    qb.leftJoinAndSelect('contract.contractPersons', 'contractPersons')
      .leftJoinAndSelect('contractPersons.person', 'person')
      .leftJoinAndSelect('person.plan', 'plan')
      .leftJoinAndSelect('contract.advisor', 'advisor')
      .leftJoinAndSelect('contract.portfolio', 'portfolio');
  }

  /**
   * Adds the ILIKE search clause for code, billing-owner name, or identity card.
   */
  private applySearchFilter(qb: SelectQueryBuilder<Contract>, search?: string): void {
    if (!search) return;
    qb.andWhere(
      '(contract.code ILIKE :search OR (contractPersons.isBillingOwner = true AND (person.name ILIKE :search OR person.identityCard ILIKE :search)))',
      { search: `%${search}%` },
    );
  }

  /**
   * Filters contracts by advisor when an advisorId is provided.
   */
  private applyAdvisorFilter(qb: SelectQueryBuilder<Contract>, advisorId?: string): void {
    if (!advisorId) return;
    qb.andWhere('contract.advisor_id = :advisorId', { advisorId });
  }

  /**
   * Joins invoices and payments. When a billing month is specified the invoice
   * join is constrained to that month only.
   */
  private applyInvoiceJoins(qb: SelectQueryBuilder<Contract>, targetBillingMonth?: string): void {
    if (targetBillingMonth) {
      qb.setParameter('targetBillingMonth', targetBillingMonth);
      qb.leftJoinAndSelect(
        'contract.invoices',
        'invoices',
        'invoices.billingMonth = :targetBillingMonth',
      ).leftJoinAndSelect('invoices.payments', 'payments');
    } else {
      qb.leftJoinAndSelect('contract.invoices', 'invoices').leftJoinAndSelect(
        'invoices.payments',
        'payments',
      );
    }
  }

  /**
   * Dispatches to the correct stage-filter strategy.
   */
  private applyStageFilter(
    qb: SelectQueryBuilder<Contract>,
    stage?: string,
    targetBillingMonth?: string,
  ): void {
    if (!stage) return;

    const stageFilterMap: Record<
      string,
      (qb: SelectQueryBuilder<Contract>, billingMonthClause: string) => void
    > = {
      rejected: this.applyRejectedFilter,
      partial: this.applyPartialFilter,
      paid: this.applyPaidFilter,
      pending: this.applyPendingFilter,
    };

    const filterFn = stageFilterMap[stage];
    if (!filterFn) return;

    const billingMonthClause = targetBillingMonth
      ? 'AND inv.billing_month = :targetBillingMonth'
      : '';

    filterFn(qb, billingMonthClause);
  }

  /**
   * Stage filter: contracts with at least one rejected payment on a
   * pending/partial invoice.
   */
  private applyRejectedFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    qb.andWhere(
      `EXISTS (
        SELECT 1 FROM invoices inv
        LEFT JOIN payments p ON p.invoice_id = inv.id
        WHERE inv.contract_id = contract.id
          ${billingMonthClause}
          AND inv.status IN ('PENDING', 'PARTIAL')
          AND p.status = 'REJECTED'
      )`,
    );
  }

  /**
   * Stage filter: contracts with a PARTIAL invoice but no rejections.
   */
  private applyPartialFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    qb.andWhere(
      `EXISTS (
        SELECT 1 FROM invoices inv
        WHERE inv.contract_id = contract.id
          ${billingMonthClause}
          AND inv.status = 'PARTIAL'
      ) AND NOT EXISTS (
        SELECT 1 FROM invoices inv
        LEFT JOIN payments p ON p.invoice_id = inv.id
        WHERE inv.contract_id = contract.id
          ${billingMonthClause}
          AND inv.status IN ('PENDING', 'PARTIAL')
          AND p.status = 'REJECTED'
      )`,
    );
  }

  /**
   * Stage filter: contracts whose relevant invoices are fully paid or cancelled.
   */
  private applyPaidFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    if (billingMonthClause) {
      // With billing month: at least one PAID/CANCELLED invoice in that month
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
            ${billingMonthClause}
            AND inv.status IN ('PAID', 'CANCELLED')
        )`,
      );
    } else {
      // Without billing month: ALL invoices must be PAID/CANCELLED
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
        ) AND NOT EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
            AND inv.status NOT IN ('PAID', 'CANCELLED')
        )`,
      );
    }
  }

  /**
   * Stage filter: contracts still pending — no rejections, no partial, and
   * not fully paid.
   */
  private applyPendingFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    if (billingMonthClause) {
      // With billing month: PENDING invoice exists and no rejections
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
            ${billingMonthClause}
            AND inv.status = 'PENDING'
        ) AND NOT EXISTS (
          SELECT 1 FROM invoices inv
          LEFT JOIN payments p ON p.invoice_id = inv.id
          WHERE inv.contract_id = contract.id
            ${billingMonthClause}
            AND inv.status IN ('PENDING', 'PARTIAL')
            AND p.status = 'REJECTED'
        )`,
      );
    } else {
      // Without billing month: no rejections, no partial, and not all paid
      qb.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM invoices inv
          LEFT JOIN payments p ON p.invoice_id = inv.id
          WHERE inv.contract_id = contract.id
            AND inv.status IN ('PENDING', 'PARTIAL')
            AND p.status = 'REJECTED'
        ) AND NOT EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
            AND inv.status = 'PARTIAL'
        ) AND (
          NOT EXISTS (SELECT 1 FROM invoices inv WHERE inv.contract_id = contract.id)
          OR EXISTS (
            SELECT 1 FROM invoices inv
            WHERE inv.contract_id = contract.id
              AND inv.status NOT IN ('PAID', 'CANCELLED')
          )
        )`,
      );
    }
  }

  async getPipelineStats(advisorId?: string, month?: string, year?: string) {
    const targetBillingMonth =
      month && year ? `${year}-${String(month).padStart(2, '0')}` : undefined;

    const contracts = await this.buildPipelineQuery(advisorId, targetBillingMonth);

    const totals: PipelineTotals = { totalPipeline: 0, totalCollected: 0, totalPending: 0 };
    const counts: PipelineCounts = { pending: 0, rejected: 0, partial: 0, paid: 0 };

    for (const contract of contracts) {
      if (targetBillingMonth) {
        this.classifyContractByMonth(contract, targetBillingMonth, totals, counts);
      } else {
        this.classifyContractCumulative(contract, totals, counts);
      }
    }

    return { stats: totals, counts };
  }

  // ---------------------------------------------------------------------------
  // getPipelineStats — private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds and executes the query to fetch contracts with their related
   * persons, invoices, and payments for the pipeline dashboard.
   */
  private async buildPipelineQuery(
    advisorId?: string,
    targetBillingMonth?: string,
  ): Promise<Contract[]> {
    const qb = this.contractsRepository.createQueryBuilder('contract');

    qb.leftJoinAndSelect('contract.contractPersons', 'contractPersons').leftJoinAndSelect(
      'contractPersons.person',
      'person',
    );

    qb.andWhere("contract.status = 'ACTIVE'");

    if (advisorId) {
      qb.andWhere('contract.advisor_id = :advisorId', { advisorId });
    }

    if (targetBillingMonth) {
      qb.leftJoinAndSelect(
        'contract.invoices',
        'invoices',
        'invoices.billingMonth = :targetBillingMonth',
        { targetBillingMonth },
      ).leftJoinAndSelect('invoices.payments', 'payments');
    } else {
      qb.leftJoinAndSelect('contract.invoices', 'invoices').leftJoinAndSelect(
        'invoices.payments',
        'payments',
      );
    }

    return qb.getMany();
  }

  /**
   * Classifies a single contract and accumulates financial stats when a
   * specific billing month is targeted.
   */
  private classifyContractByMonth(
    contract: Contract,
    targetBillingMonth: string,
    totals: PipelineTotals,
    counts: PipelineCounts,
  ): void {
    const targetInvoice = contract.invoices?.find((inv) => inv.billingMonth === targetBillingMonth);
    if (!targetInvoice) return;

    totals.totalPipeline += Number(targetInvoice.baseAmount ?? targetInvoice.totalAmount);

    const hasRejection = targetInvoice.payments?.some((p) => p.status === 'REJECTED');
    if (
      hasRejection &&
      (targetInvoice.status === 'PENDING' || targetInvoice.status === 'PARTIAL')
    ) {
      counts.rejected++;
    } else if (targetInvoice.status === 'PARTIAL') {
      counts.partial++;
    } else if (targetInvoice.status === 'PAID' || targetInvoice.status === 'CANCELLED') {
      counts.paid++;
    } else {
      counts.pending++;
    }

    this.accumulateInvoiceStats(targetInvoice, totals);
  }

  /**
   * Classifies a single contract and accumulates financial stats across
   * all invoices (no specific billing month).
   */
  private classifyContractCumulative(
    contract: Contract,
    totals: PipelineTotals,
    counts: PipelineCounts,
  ): void {
    totals.totalPipeline += Number(contract.monthlyAmount);

    const hasRejection = contract.invoices?.some(
      (inv) =>
        (inv.status === 'PENDING' || inv.status === 'PARTIAL') &&
        inv.payments?.some((p) => p.status === 'REJECTED'),
    );

    if (hasRejection) {
      counts.rejected++;
    } else {
      const hasPartial = contract.invoices?.some((inv) => inv.status === 'PARTIAL');
      if (hasPartial) {
        counts.partial++;
      } else {
        const allPaid =
          !!contract.invoices &&
          contract.invoices.length > 0 &&
          contract.invoices.every((inv) => inv.status === 'PAID' || inv.status === 'CANCELLED');
        counts[allPaid ? 'paid' : 'pending']++;
      }
    }

    contract.invoices?.forEach((inv) => this.accumulateInvoiceStats(inv, totals));
  }

  /**
   * Adds a single invoice's financial contribution to the running totals.
   */
  private accumulateInvoiceStats(
    inv: {
      status: string;
      totalAmount: number;
      paidAmount: number;
      baseAmount?: number;
      retentionAmount?: number;
    },
    totals: PipelineTotals,
  ): void {
    const retention = Number(inv.retentionAmount || 0);
    const amountDue = Math.max(0, Number(inv.baseAmount ?? inv.totalAmount) - retention);

    if (inv.status === 'PAID') {
      totals.totalCollected += Number(inv.paidAmount);
    } else if (inv.status === 'PARTIAL') {
      totals.totalCollected += Number(inv.paidAmount);
      totals.totalPending += Math.max(0, amountDue - Number(inv.paidAmount));
    } else if (inv.status === 'PENDING') {
      totals.totalPending += amountDue;
    }
  }

  async findByCode(code: string): Promise<Contract> {
    return this.contractsRepository.findOne({
      where: { code },
      relations: ['contractPersons', 'contractPersons.person', 'contractPersons.person.plan'],
    });
  }
  async findOne(id: string): Promise<Contract> {
    const contract = await this.contractsRepository.findOne({
      where: { id },
      relations: [
        'contractPersons',
        'contractPersons.person',
        'contractPersons.person.plan',
        'invoices',
        'invoices.payments',
        'surpluses',
        'surpluses.payment',
        'advisor',
        'portfolio',
      ],
    });
    if (!contract) {
      throw new NotFoundException(`Contract with ID "${id}" not found`);
    }
    return contract;
  }

  async update(id: string, updateContractDto: UpdateContractDto): Promise<Contract> {
    const contract = await this.findOne(id);
    const { advisorId, portfolioId, ...rest } = updateContractDto;

    if (updateContractDto.code) {
      const existing = await this.contractsRepository
        .createQueryBuilder('contract')
        .where('contract.code = :code AND contract.id != :id', { code: updateContractDto.code, id })
        .getOne();
      if (existing) {
        throw new BadRequestException(
          `El código de contrato "${updateContractDto.code}" ya está registrado en otro contrato.`,
        );
      }
    }

    Object.assign(contract, rest);

    if (advisorId !== undefined) {
      contract.advisor = advisorId ? ({ id: advisorId } as Advisor) : null;
    }

    if (portfolioId !== undefined) {
      contract.portfolio = portfolioId ? ({ id: portfolioId } as Portfolio) : null;
    }

    return this.contractsRepository.save(contract);
  }

  async remove(id: string): Promise<void> {
    const contract = await this.findOne(id);
    await this.contractsRepository.softRemove(contract);
  }

  /**
   * Assigns (or replaces) the advisor of an existing contract.
   * Pass null as advisorId to detach the current advisor.
   */
  async setAdvisor(contractId: string, advisorId: string | null): Promise<void> {
    await this.contractsRepository.save({
      id: contractId,
      advisor: advisorId ? { id: advisorId } : null,
    });
  }

  async removeAffiliate(contractPersonId: string): Promise<void> {
    const contractPerson = await this.contractPersonsRepository.findOne({
      where: { id: contractPersonId },
      relations: ['contract', 'person', 'person.plan'],
    });

    if (!contractPerson) {
      throw new NotFoundException(`Contract person with ID "${contractPersonId}" not found`);
    }

    if (contractPerson.role === 'TITULAR') {
      throw new BadRequestException('El TITULAR no puede ser eliminado');
    }

    if (contractPerson.isBillingOwner) {
      throw new BadRequestException('Debe existir un responsable de facturación');
    }

    await this.contractsRepository.manager.transaction(async (manager) => {
      const historyRepo = manager.getRepository(AffiliationHistory);
      const cpRepo = manager.getRepository(ContractPerson);

      // Registrar en historial ANTES de eliminar
      await historyRepo.save(
        historyRepo.create({
          contract: contractPerson.contract,
          person: contractPerson.person,
          plan: contractPerson.person?.plan ?? null,
          action: AffiliationAction.DESAFILIACION,
          amount: Number(contractPerson.person?.plan?.amount ?? 0),
          reason: null,
        }),
      );

      // Soft delete (no hard delete) para mantener trazabilidad
      await cpRepo.softRemove(contractPerson);

      // Billing es responsable de limpiar la línea MENSUALIDAD de la factura activa
      await this.billingService.removeAffiliateLineFromActiveInvoice(
        contractPerson.contract.id,
        contractPerson.person.id,
        manager,
      );

      // Recalcular el monto mensual
      await this.recalculateMonthlyAmount(contractPerson.contract.id, manager);
    });
  }

  /**
   * Recalculates the monthly amount for a given contract ID
   * by summing the amount of all plans associated to its persons (only AFILIADOS have plans).
   */
  async recalculateMonthlyAmount(contractId: string, manager?: EntityManager): Promise<void> {
    const cpRepo = manager ? manager.getRepository(ContractPerson) : this.contractPersonsRepository;
    const contractRepo = manager ? manager.getRepository(Contract) : this.contractsRepository;

    const affiliates = await cpRepo.find({
      where: {
        contract: { id: contractId },
        person: { status: PersonStatus.ACTIVE },
      },
      relations: ['person', 'person.plan'],
    });

    const totalAmount = affiliates.reduce((sum, cp) => {
      // Sum the plan amount if the person is an AFILIADO and has a plan
      if (cp.role === 'AFILIADO' && cp.person && cp.person.plan) {
        return sum + Number(cp.person.plan.amount);
      }
      return sum;
    }, 0);

    await contractRepo.update(contractId, { monthlyAmount: totalAmount });
  }

  async addBeneficiary(contractId: string, dto: CreateBeneficiaryDto): Promise<Person> {
    return this.personsService.create({
      ...dto,
      contractId,
    });
  }

  async setContractTitular(contractId: string, dto: SetContractTitularDto): Promise<void> {
    const { contractPersonId } = dto;

    const target = await this.contractPersonsRepository.findOne({
      where: { id: contractPersonId, contract: { id: contractId } },
    });

    if (!target) {
      throw new NotFoundException('Afiliado no encontrado en este contrato.');
    }

    await this.contractPersonsRepository.manager.transaction(async (entityManager) => {
      const isAlreadyTitular = target.role === PersonRole.TITULAR;

      // Revertir a todos los demás titulares actuales a afiliados (AFILIADO)
      await entityManager.update(
        ContractPerson,
        { contract: { id: contractId }, deletedAt: IsNull() },
        { role: PersonRole.AFILIADO },
      );

      // Si antes era titular, al hacer click de nuevo se desmarca (se vuelve AFILIADO).
      // Si no lo era, pasa a ser el nuevo titular (TITULAR).
      target.role = isAlreadyTitular ? PersonRole.AFILIADO : PersonRole.TITULAR;
      await entityManager.save(ContractPerson, target);
    });

    // Recalcular la facturación mensual del contrato (el titular no aporta al costo mensual, los afiliados sí)
    await this.recalculateMonthlyAmount(contractId);
  }

  async setBillingOwner(contractId: string, dto: SetBillingOwnerDto): Promise<void> {
    const { contractPersonId } = dto;

    const target = await this.contractPersonsRepository.findOne({
      where: { id: contractPersonId, contract: { id: contractId } },
    });

    if (!target) {
      throw new NotFoundException('Afiliado no encontrado en este contrato.');
    }

    await this.contractPersonsRepository.manager.transaction(async (entityManager) => {
      // Desmarcar a todos los demás responsables de cobro en este contrato
      await entityManager.update(
        ContractPerson,
        { contract: { id: contractId }, deletedAt: IsNull() },
        { isBillingOwner: false },
      );

      // Marcar al nuevo responsable
      target.isBillingOwner = true;
      await entityManager.save(ContractPerson, target);
    });
  }

  async getAffiliationStats(month: number, year: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const stats = await this.affiliationHistoryRepository
      .createQueryBuilder('h')
      .select([
        `SUM(CASE WHEN h.action = 'AFILIACION' THEN 1 ELSE 0 END) AS new_affiliations`,
        `SUM(CASE WHEN h.action = 'DESAFILIACION' THEN 1 ELSE 0 END) AS disaffiliations`,
        `SUM(CASE WHEN h.action = 'AFILIACION' THEN h.amount ELSE 0 END) AS revenue_gained`,
        `SUM(CASE WHEN h.action = 'DESAFILIACION' THEN h.amount ELSE 0 END) AS revenue_lost`,
      ])
      .where('h.action_date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawOne();

    return {
      newAffiliations: Number(stats?.new_affiliations ?? 0),
      disaffiliations: Number(stats?.disaffiliations ?? 0),
      revenueGained: Number(stats?.revenue_gained ?? 0),
      revenueLost: Number(stats?.revenue_lost ?? 0),
      netChange: Number(stats?.new_affiliations ?? 0) - Number(stats?.disaffiliations ?? 0),
      netRevenueChange: Number(stats?.revenue_gained ?? 0) - Number(stats?.revenue_lost ?? 0),
    };
  }
}
