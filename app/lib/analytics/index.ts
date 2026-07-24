import { RealAnalyticsProvider } from "./real-provider";
import type { AnalyticsProvider } from "./types";

export function getAnalyticsProvider(organizationId: string): AnalyticsProvider {
  return new RealAnalyticsProvider(organizationId);
}

export type { AnalyticsDailyMetric, AnalyticsProperty, AnalyticsProvider } from "./types";
