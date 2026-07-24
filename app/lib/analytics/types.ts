export type AnalyticsProperty = {
  propertyResourceName: string; // "properties/123456789"
  displayName: string;
};

export type AnalyticsDailyMetric = {
  date: string; // ISO date (YYYY-MM-DD)
  sessions: number;
  activeUsers: number;
  pageviews: number;
  bounceRate: number; // 0..1
};

export interface AnalyticsProvider {
  listProperties(): Promise<AnalyticsProperty[]>;
  getMetrics(propertyResourceName: string, days: number): Promise<AnalyticsDailyMetric[]>;
}
