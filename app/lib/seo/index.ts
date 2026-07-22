import { MockSeoProvider } from "./mock-provider";
import type { SeoProvider } from "./types";

/**
 * No real crawler / PageSpeed / Google Search Console / Analytics
 * credentials exist yet (GOOGLE_CLIENT_ID/SECRET are still placeholders —
 * see README). Always resolves to the mock provider for now; swap in a
 * real crawler + Search Console/Analytics-backed SeoProvider here once
 * credentials exist.
 */
export function getSeoProvider(): SeoProvider {
  return new MockSeoProvider();
}

export type {
  SeoAnalyticsSnapshot,
  SeoIssueCategory,
  SeoIssuePriority,
  SeoKeywordRanking,
  SeoProvider,
  SeoSearchConsoleSnapshot,
  SeoTechnicalAuditResult,
  SeoTechnicalIssue,
} from "./types";
