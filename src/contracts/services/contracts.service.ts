import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { Person } from '../../persons/entities/person.entity';
import { CreateBeneficiaryDto } from '../dto/create-beneficiary.dto';
import { CreateContractFullDto } from '../dto/create-contract-full.dto';
import { FindContractDto } from '../dto/find-contract.dto';
import { InactivateContractDto } from '../dto/inactivate-contract.dto';
import { SetBillingOwnerDto } from '../dto/set-billing-owner.dto';
import { SetContractTitularDto } from '../dto/set-contract-titular.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { Contract } from '../entities/contract.entity';
import {
  AffiliationStatsMode,
  AffiliationStatsResult,
} from '../interfaces/affiliation-stats.interface';
import {
  PipelineCounts,
  PipelineStatsResult,
  PipelineTotals,
} from '../interfaces/pipeline-stats.interface';
import { ContractQueryRepository } from '../repositories/contract-query.repository';
import { ContractAffiliationService } from './contract-affiliation.service';
import { ContractCreationService } from './contract-creation.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractPdfService } from './contract-pdf.service';
import { ContractStatisticsService } from './contract-statistics.service';

export type { PipelineTotals, PipelineCounts, PipelineStatsResult, AffiliationStatsResult };

/**
 * Public Facade for the Contracts module.
 *
 * Preserves 100% backward compatibility for all consumers (controllers, crons, PersonsService)
 * while delegating internally to specialized, single-responsibility domain services:
 * - `ContractCreationService`   → Contract creation & affiliate onboarding
 * - `ContractLifecycleService`  → Activation, inactivation, updates & soft-deletes
 * - `ContractAffiliationService`→ Beneficiaries, titular toggling, billing owners & recalculations
 * - `ContractPdfService`        → Template formatting, PDF generation & S3 storage
 * - `ContractStatisticsService` → Pipeline classification & affiliation period analytics
 * - `ContractQueryRepository`   → Query building, pagination & stage filters
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly creationService: ContractCreationService,
    private readonly lifecycleService: ContractLifecycleService,
    private readonly affiliationService: ContractAffiliationService,
    private readonly pdfService: ContractPdfService,
    private readonly statisticsService: ContractStatisticsService,
    private readonly queryRepository: ContractQueryRepository,
  ) {}

  // ── 1. Creation ────────────────────────────────────────────────────────────
  async createFull(dto: CreateContractFullDto): Promise<Contract> {
    return this.creationService.createFull(dto);
  }

  // ── 2. Queries & Search ───────────────────────────────────────────────────
  async findAll(query: FindContractDto): Promise<PaginatedResult<Contract>> {
    return this.queryRepository.findAllPaginated(query);
  }

  async findOne(id: string): Promise<Contract> {
    return this.lifecycleService.findOne(id);
  }

  async findByCode(code: string): Promise<Contract | null> {
    return this.lifecycleService.findByCode(code);
  }

  // ── 3. Lifecycle & Updates ────────────────────────────────────────────────
  async update(id: string, updateContractDto: UpdateContractDto): Promise<Contract> {
    return this.lifecycleService.update(id, updateContractDto);
  }

  async remove(id: string): Promise<void> {
    return this.lifecycleService.remove(id);
  }

  async inactivate(contractId: string, dto: InactivateContractDto): Promise<Contract> {
    return this.lifecycleService.inactivate(contractId, dto);
  }

  async activate(contractId: string): Promise<Contract> {
    return this.lifecycleService.activate(contractId);
  }

  async setAdvisor(contractId: string, advisorId: string | null): Promise<void> {
    return this.lifecycleService.setAdvisor(contractId, advisorId);
  }

  // ── 4. Affiliations & Beneficiaries ───────────────────────────────────────
  async addBeneficiary(contractId: string, dto: CreateBeneficiaryDto): Promise<Person> {
    return this.affiliationService.addBeneficiary(contractId, dto);
  }

  async removeAffiliate(contractPersonId: string, contractId?: string): Promise<void> {
    return this.affiliationService.removeAffiliate(contractPersonId, contractId);
  }

  async setContractTitular(contractId: string, dto: SetContractTitularDto): Promise<void> {
    return this.affiliationService.setContractTitular(contractId, dto);
  }

  async setBillingOwner(contractId: string, dto: SetBillingOwnerDto): Promise<void> {
    return this.affiliationService.setBillingOwner(contractId, dto);
  }

  async recalculateMonthlyAmount(contractId: string, manager?: EntityManager): Promise<void> {
    return this.affiliationService.recalculateMonthlyAmount(contractId, manager);
  }

  // ── 5. Documents & PDF ────────────────────────────────────────────────────
  async generateContractPdfBuffer(contractId: string): Promise<Buffer | null> {
    return this.pdfService.generateContractPdfBuffer(contractId);
  }

  async generateAndUploadContractPdf(contractId: string): Promise<string | null> {
    return this.pdfService.generateAndUploadContractPdf(contractId);
  }

  // ── 6. Statistics & Analytics ─────────────────────────────────────────────
  async getPipelineStats(
    advisorId?: string,
    month?: string | number,
    year?: string | number,
  ): Promise<PipelineStatsResult> {
    return this.statisticsService.getPipelineStats(advisorId, month, year);
  }

  async getAffiliationStats(
    month: number,
    year: number,
    mode: AffiliationStatsMode = 'billing',
  ): Promise<AffiliationStatsResult> {
    return this.statisticsService.getAffiliationStats(month, year, mode);
  }
}
