import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { paginateQueryBuilder } from '../../common/utils/pagination.util';
import { FindContractDto } from '../dto/find-contract.dto';
import { Contract } from '../entities/contract.entity';

@Injectable()
export class ContractQueryRepository {
  constructor(
    @InjectRepository(Contract)
    private readonly contractsRepository: Repository<Contract>,
  ) {}

  /**
   * Executes a paginated query with dynamic filters, searches, advisor criteria,
   * stage classification, and billing month joins.
   */
  async findAllPaginated(query: FindContractDto): Promise<PaginatedResult<Contract>> {
    const qb = this.contractsRepository.createQueryBuilder('contract');
    const targetBillingMonth = this.buildTargetBillingMonth(query);

    this.applyRelations(qb);
    this.applySearchFilter(qb, query.search);
    this.applySpecificFilters(qb, query);
    this.applyAdvisorFilter(qb, query.advisorId);

    if (query.stage || targetBillingMonth) {
      this.applyInvoiceJoins(qb, targetBillingMonth);
      this.applyStageFilter(qb, query.stage, targetBillingMonth);
    }

    if (query.stage) {
      qb.andWhere("contract.status = 'ACTIVE'");
    } else if (query.status) {
      qb.andWhere('contract.status = :status', { status: query.status });
    }

    qb.orderBy('contract.code', 'ASC');

    return paginateQueryBuilder(qb, query);
  }

  /**
   * Builds and executes the query to fetch contracts with their related
   * persons, invoices, and payments for pipeline dashboard calculations.
   */
  async findContractsForPipeline(
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
   * Helper: Builds YYYY-MM billing month string when month and year are present.
   */
  buildTargetBillingMonth(query: {
    month?: string | number;
    year?: string | number;
  }): string | undefined {
    if (query.month && query.year) {
      return `${query.year}-${String(query.month).padStart(2, '0')}`;
    }
    return undefined;
  }

  /**
   * Helper: Joins relations needed for contract listings.
   */
  private applyRelations(qb: SelectQueryBuilder<Contract>): void {
    qb.leftJoinAndSelect('contract.contractPersons', 'contractPersons')
      .leftJoinAndSelect('contractPersons.person', 'person')
      .leftJoinAndSelect('person.plan', 'plan')
      .leftJoinAndSelect('contract.advisor', 'advisor')
      .leftJoinAndSelect('contract.portfolio', 'portfolio');
  }

  /**
   * Helper: Adds ILIKE search clause for code, legacy code, or associated person.
   */
  private applySearchFilter(qb: SelectQueryBuilder<Contract>, search?: string): void {
    if (!search) return;
    qb.andWhere(
      "(contract.code ILIKE :search OR contract.legacy_code ILIKE :search OR person.name ILIKE :search OR person.identityCard ILIKE :search OR CONCAT(person.typeIdentityCard, '-', person.identityCard) ILIKE :search OR CONCAT(person.typeIdentityCard, person.identityCard) ILIKE :search)",
      { search: `%${search}%` },
    );
  }

  /**
   * Helper: Applies specific field filters when provided in query.
   */
  private applySpecificFilters(qb: SelectQueryBuilder<Contract>, query: FindContractDto): void {
    if (query.code) {
      qb.andWhere('contract.code ILIKE :codeFilter', { codeFilter: `%${query.code}%` });
    }
    if (query.legacyCode) {
      qb.andWhere('contract.legacy_code ILIKE :legacyCodeFilter', {
        legacyCodeFilter: `%${query.legacyCode}%`,
      });
    }
    if (query.identityCard) {
      qb.andWhere(
        "(person.identityCard ILIKE :idCardFilter OR CONCAT(person.typeIdentityCard, '-', person.identityCard) ILIKE :idCardFilter OR CONCAT(person.typeIdentityCard, person.identityCard) ILIKE :idCardFilter)",
        { idCardFilter: `%${query.identityCard}%` },
      );
    }
    if (query.beneficiaryName) {
      qb.andWhere('person.name ILIKE :beneficiaryNameFilter', {
        beneficiaryNameFilter: `%${query.beneficiaryName}%`,
      });
    }
  }

  /**
   * Helper: Filters contracts by advisor ID.
   */
  private applyAdvisorFilter(qb: SelectQueryBuilder<Contract>, advisorId?: string): void {
    if (!advisorId) return;
    qb.andWhere('contract.advisor_id = :advisorId', { advisorId });
  }

  /**
   * Helper: Joins invoices and payments, constraining by target billing month if specified.
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
   * Helper: Dispatches to stage filter strategy.
   */
  private applyStageFilter(
    qb: SelectQueryBuilder<Contract>,
    stage?: string,
    targetBillingMonth?: string,
  ): void {
    if (!stage) return;

    const billingMonthClause = targetBillingMonth
      ? 'AND inv.billing_month = :targetBillingMonth'
      : '';

    switch (stage) {
      case 'rejected':
        this.applyRejectedFilter(qb, billingMonthClause);
        break;
      case 'partial':
        this.applyPartialFilter(qb, billingMonthClause);
        break;
      case 'paid':
        this.applyPaidFilter(qb, billingMonthClause);
        break;
      case 'pending':
        this.applyPendingFilter(qb, billingMonthClause);
        break;
    }
  }

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

  private applyPaidFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    if (billingMonthClause) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.contract_id = contract.id
            ${billingMonthClause}
            AND inv.status IN ('PAID', 'CANCELLED')
        )`,
      );
    } else {
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

  private applyPendingFilter(qb: SelectQueryBuilder<Contract>, billingMonthClause: string): void {
    if (billingMonthClause) {
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
}
