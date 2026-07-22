import { RealSearchConsoleProvider } from "./real-provider";
import type { SearchConsoleProvider } from "./types";

export function getSearchConsoleProvider(organizationId: string): SearchConsoleProvider {
  return new RealSearchConsoleProvider(organizationId);
}

export type { SearchConsoleDailyMetric, SearchConsoleProperty, SearchConsoleProvider } from "./types";
