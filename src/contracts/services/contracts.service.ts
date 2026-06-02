import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { paginateQueryBuilder } from '../../common/utils/pagination.util';
import { Person, PersonStatus } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { CreateContractDto } from '../dto/create-contract.dto';
import { FindContractDto } from '../dto/find-contract.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { Contract } from '../entities/contract.entity';

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
    @Inject(forwardRef(() => PersonsService))
    private personsService: PersonsService,
  ) {}

  async create(createContractDto: CreateContractDto): Promise<Contract> {
    const { advisorId, ...rest } = createContractDto;
    const contract = this.contractsRepository.create({
      ...rest,
      ...(advisorId ? { advisor: { id: advisorId } } : {}),
    });
    return this.contractsRepository.save(contract);
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
      .leftJoinAndSelect('contract.advisor', 'advisor');
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

    totals.totalPipeline += Number(targetInvoice.totalAmount);

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
    inv: { status: string; totalAmount: number; paidAmount: number },
    totals: PipelineTotals,
  ): void {
    if (inv.status === 'PAID') {
      totals.totalCollected += Number(inv.paidAmount);
    } else if (inv.status === 'PARTIAL') {
      totals.totalCollected += Number(inv.paidAmount);
      totals.totalPending += Number(inv.totalAmount - inv.paidAmount);
    } else if (inv.status === 'PENDING') {
      totals.totalPending += Number(inv.totalAmount);
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
      ],
    });
    if (!contract) {
      throw new NotFoundException(`Contract with ID "${id}" not found`);
    }
    return contract;
  }

  async update(id: string, updateContractDto: UpdateContractDto): Promise<Contract> {
    const contract = await this.findOne(id);
    const updatedContract = Object.assign(contract, updateContractDto);
    return this.contractsRepository.save(updatedContract);
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
      relations: ['contract'],
    });
    const contract = await this.findOne(contractPerson.contract.id);

    if (!contract) {
      throw new NotFoundException(`Contract with ID "${contractPerson.contract.id}" not found`);
    }

    if (!contractPerson) {
      throw new NotFoundException(`Contract person with ID "${contractPersonId}" not found`);
    }

    if (contractPerson.role === 'TITULAR') {
      throw new BadRequestException('El TITULAR no puede ser eliminado');
    }

    if (contractPerson.isBillingOwner) {
      throw new BadRequestException('Debe existir un responsable de facturación');
    }

    await this.contractPersonsRepository.remove(contractPerson);
    // Re-calculate the monthly amount
    await this.recalculateMonthlyAmount(contract.id);
  }

  /**
   * Recalculates the monthly amount for a given contract ID
   * by summing the amount of all plans associated to its persons (only AFILIADOS have plans).
   */
  async recalculateMonthlyAmount(contractId: string): Promise<void> {
    const affiliates = await this.contractPersonsRepository.find({
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

    await this.contractsRepository.update(contractId, { monthlyAmount: totalAmount });
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
        { contract: { id: contractId } },
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
        { contract: { id: contractId } },
        { isBillingOwner: false },
      );

      // Marcar al nuevo responsable
      target.isBillingOwner = true;
      await entityManager.save(ContractPerson, target);
    });
  }
}
