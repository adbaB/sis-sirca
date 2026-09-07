export type AffiliationStatsMode = 'billing' | 'calendar';

export interface AffiliationStatsPeriod {
  startDate: string;
  endDate: string;
}

export interface AffiliationStatsResult {
  mode: AffiliationStatsMode;
  period: AffiliationStatsPeriod;
  newAffiliations: number;
  disaffiliations: number;
  revenueGained: number;
  revenueLost: number;
  netChange: number;
  netRevenueChange: number;
}
