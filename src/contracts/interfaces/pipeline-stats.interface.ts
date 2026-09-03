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

export interface PipelineStatsResult {
  stats: PipelineTotals;
  counts: PipelineCounts;
}
