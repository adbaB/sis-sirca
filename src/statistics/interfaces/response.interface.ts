/* ──────────────────────────────────────────────────────
   SIRCA Dashboard — TypeScript Interfaces
   ────────────────────────────────────────────────────── */

/** Advisor returned from /api/mock/advisors */
export interface Advisor {
  uuid: string;
  name: string;
}

/** High-level KPI summary for a given period */
export interface StatisticsSummary {
  totalPaymentsVerified: number;
  totalPaymentsUnverified: number;
  totalPaymentsPartial: number;
  totalPaymentsPending: number;
  totalAmountVerifiedUsd: number;
  totalAmountUnverifiedUsd: number;
  totalPendingUsd: number;
  totalToPayUsd: number;
  /** SUM(total_amount) for ALL invoices in the billing month — grand billing total */
  totalInvoiceAmount: number;
  /** SUM(base_amount) for recurring plan lines in the billing month */
  totalBaseAmount: number;
  /** SUM(retention_amount) for all invoices in the billing month */
  totalRetentionAmount: number;
  /** SUM(paid_amount) for PAID + PARTIAL invoices — everything collected so far */
  totalCollected: number;
  /** SUM(quantity) of MENSUALIDAD and INCLUSION invoice lines for the billing month */
  totalAffiliates: number;
  /** Count of INCLUSION lines */
  inclusionCount?: number;
  /** SUM(amount * quantity) of INCLUSION lines */
  inclusionAmount?: number;
  /** Count of SUSCRIPCION (contract opening fee) lines */
  subscriptionFeesCount: number;
  /** SUM(amount * quantity) of SUSCRIPCION (contract opening fee) lines */
  subscriptionFeesAmount: number;
}

/** Payment status breakdown row */
export interface PaymentBreakdown {
  status: 'verified' | 'unverified' | 'partial' | 'pending';
  count: number;
  amountUsd: number;
  amountBs: number;
}

/** Monthly trend data point */
export interface MonthlyTrend {
  month: string;
  verified: number;
  pending: number;
}

/** Full statistics API response */
export interface StatisticsResponse {
  summary: StatisticsSummary;
  breakdown: PaymentBreakdown[];
}

/** Filter state for dashboard */
export interface DashboardFilters {
  year: number;
  month: number;
  advisorUuid: string;
}
