export type SearchConsoleProperty = {
  siteUrl: string;
  permissionLevel: string | null;
};

export type SearchConsoleDailyMetric = {
  date: string; // ISO date (YYYY-MM-DD)
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number; // average position, e.g. 12.34
};

export interface SearchConsoleProvider {
  listProperties(): Promise<SearchConsoleProperty[]>;
  getPerformance(siteUrl: string, days: number): Promise<SearchConsoleDailyMetric[]>;
}
