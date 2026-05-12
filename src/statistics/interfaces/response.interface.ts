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
  /** SUM(paid_amount) for PAID + PARTIAL invoices — everything collected so far */
  totalCollected: number;
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
