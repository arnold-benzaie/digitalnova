export type SeoIssueCategory = "metadata" | "headings" | "indexability" | "sitemap" | "robots" | "performance";
export type SeoIssuePriority = "low" | "medium" | "high";

export type SeoTechnicalIssue = {
  category: SeoIssueCategory;
  title: string;
  description: string;
  priority: SeoIssuePriority;
  recommendation: string;
};

export type SeoTechnicalAuditResult = {
  score: number;
  summary: string;
  pageTitle: string | null;
  metaDescription: string | null;
  h1Count: number;
  indexable: boolean;
  sitemapFound: boolean;
  robotsTxtFound: boolean;
  issues: SeoTechnicalIssue[];
};

export type SeoKeywordRanking = {
  keyword: string;
  position: number | null;
  searchEngine: string;
};

export type SeoSearchConsoleSnapshot = {
  impressions: number;
  clicks: number;
  averagePosition: number;
  ctrPercent: number;
};

export type SeoAnalyticsSnapshot = {
  sessions: number;
  pageviews: number;
  bounceRatePercent: number;
  avgSessionSeconds: number;
};

export interface SeoProvider {
  runTechnicalAudit(url: string): Promise<SeoTechnicalAuditResult>;
  checkKeywordRankings(url: string, keywords: string[]): Promise<SeoKeywordRanking[]>;
  fetchSearchConsoleSnapshot(url: string): Promise<SeoSearchConsoleSnapshot>;
  fetchAnalyticsSnapshot(url: string): Promise<SeoAnalyticsSnapshot>;
}
