export interface DailyEventualityStatItem {
  date: string;
  day: number;
  label: string;
  fullDate: string;
  count: number;
}

export interface EventualityDailyStatsResponse {
  period: {
    startDate: string;
    endDate: string;
    month: number;
    year: number;
    monthLabel: string;
  };
  totalCount: number;
  dailyAverage: number;
  peakDay: {
    date: string | null;
    label: string | null;
    count: number;
  };
  days: DailyEventualityStatItem[];
}
