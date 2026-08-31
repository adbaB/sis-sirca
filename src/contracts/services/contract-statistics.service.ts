import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DateTime } from 'luxon';
import { Repository } from 'typeorm';
import { CARACAS_ZONE } from '../../common/utils/date.util';
import { AffiliationHistory } from '../entities/affiliation-history.entity';
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

@Injectable()
export class ContractStatisticsService {
  constructor(
    private readonly contractQueryRepo: ContractQueryRepository,
    @InjectRepository(AffiliationHistory)
    private readonly affiliationHistoryRepository: Repository<AffiliationHistory>,
  ) {}

  /**
   * Calculates financial metrics and contract counts by stage for the dashboard pipeline.
   */
  async getPipelineStats(
    advisorId?: string,
    month?: string,
    year?: string,
  ): Promise<PipelineStatsResult> {
    const targetBillingMonth = this.contractQueryRepo.buildTargetBillingMonth({ month, year });

    const contracts = await this.contractQueryRepo.findContractsForPipeline(
      advisorId,
      targetBillingMonth,
    );

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

  /**
   * Calculates new affiliations, disaffiliations, and net revenue changes
   * either by calendar month or standard billing period (25 to 24).
   */
  async getAffiliationStats(
    month: number,
    year: number,
    mode: AffiliationStatsMode = 'billing',
  ): Promise<AffiliationStatsResult> {
    const monthDt = DateTime.fromObject({ year, month, day: 1 }, { zone: CARACAS_ZONE });
    let start: DateTime;
    let end: DateTime;

    if (mode === 'calendar') {
      start = monthDt.startOf('month');
      end = monthDt.endOf('month');
    } else {
      // Billing cycle mode: from day 25 of previous month to day 24 of target month
      start = monthDt.minus({ months: 1 }).set({ day: 25 }).startOf('day');
      end = monthDt.set({ day: 24 }).endOf('day');
    }

    const startDateStr = start.toFormat('yyyy-MM-dd HH:mm:ss');
    const endDateStr = end.toFormat('yyyy-MM-dd HH:mm:ss');

    const stats = await this.affiliationHistoryRepository
      .createQueryBuilder('h')
      .select([
        `SUM(CASE WHEN h.action = 'AFILIACION' THEN 1 ELSE 0 END) AS new_affiliations`,
        `SUM(CASE WHEN h.action IN ('DESAFILIACION', 'CAMBIO_CONTRATO') THEN 1 ELSE 0 END) AS disaffiliations`,
        `SUM(CASE WHEN h.action = 'AFILIACION' THEN h.amount ELSE 0 END) AS revenue_gained`,
        `SUM(CASE WHEN h.action IN ('DESAFILIACION', 'CAMBIO_CONTRATO') THEN h.amount ELSE 0 END) AS revenue_lost`,
      ])
      .where('h.action_date BETWEEN :startDateStr AND :endDateStr', { startDateStr, endDateStr })
      .getRawOne();

    const newAffiliations = Number(stats?.new_affiliations ?? 0);
    const disaffiliations = Number(stats?.disaffiliations ?? 0);
    const revenueGained = Number(stats?.revenue_gained ?? 0);
    const revenueLost = Number(stats?.revenue_lost ?? 0);

    return {
      mode,
      period: {
        startDate: start.toFormat('yyyy-MM-dd'),
        endDate: end.toFormat('yyyy-MM-dd'),
      },
      newAffiliations,
      disaffiliations,
      revenueGained,
      revenueLost,
      netChange: newAffiliations - disaffiliations,
      netRevenueChange: revenueGained - revenueLost,
    };
  }

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
}
