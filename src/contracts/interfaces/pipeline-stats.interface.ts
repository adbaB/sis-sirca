export interface PipelineTotals {
  totalPipeline: number;
  totalCollected: number;
  totalPending: number;
  totalRetention?: number;
  baseRecurring?: number;
  inclusionAmount?: number;
  inclusionCount?: number;
  subscriptionAmount?: number;
  subscriptionCount?: number;
}

export interface PipelineCounts {
  pending: number;
  rejected: number;
  partial: number;
  paid: number;
}

export interface PipelineStatsResult {
  stats: PipelineTotals;
  counts: PipelineCounts;
}
