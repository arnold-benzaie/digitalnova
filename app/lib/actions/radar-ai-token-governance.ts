"use server";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G3B — OWNER-only token GOVERNANCE
 * reporting: a single, read-only Server Action packaging
 * lib/radar-intelligence/token-accounting.ts (Phase G3A) into one safe
 * snapshot for the OWNER usage page. Deliberately separate from Phase
 * B/C/D's ROUTING POLICY actions and Phase E's MODEL/CREDENTIAL
 * operations actions — this file only ever READS historical telemetry
 * aggregates; it mutates nothing.
 *
 * `requireStaffMember("RADAR_AI_POLICY_MANAGE")` is the literal first
 * statement — the same OWNER-exclusive permission this entire feature
 * area already uses (never `SYSTEM_ADMIN`, which ADMIN also holds, and
 * never `ANALYTICS_TEAM_VIEW`, a different domain granted to
 * OWNER/ADMIN/MANAGER — see the G3B architecture review for the full
 * reasoning). Independently re-checked here, never relying on the page's
 * own check or on sidebar visibility.
 *
 * ZERO NEW SQL: every number in the returned snapshot comes verbatim
 * from one of token-accounting.ts's own six exported functions — this
 * file never queries the DB directly and never re-implements
 * aggregation logic.
 *
 * NO COST: no estimatedCost/price/pricing/USD/EUR/CAD figure exists
 * anywhere in this file. See token-accounting.ts's own "Cost-engine
 * boundary" discussion for the documented, NOT-YET-BUILT interface a
 * future, separately authorized pricing slice would consume.
 */
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import {
  getGlobalTokenUsage,
  getSuccessfulAdvisoryCount,
  getSuccessfulFallbackAdvisoryCount,
  getTokenUsageByModel,
  getTokenUsageByProvider,
  getTokenUsageBySelectionMode,
  type ModelTokenUsage,
  type ProviderTokenUsage,
  type SelectionModeTokenUsage,
  type TokenAccountingWindow,
  type TokenUsageTotals,
} from "@/lib/radar-intelligence/token-accounting";

export type TokenGovernanceSnapshot = {
  window: TokenAccountingWindow;
  totals: TokenUsageTotals;
  successfulAdvisories: number;
  successfulFallbackAdvisories: number;
  byProvider: ProviderTokenUsage[];
  byModel: ModelTokenUsage[];
  bySelectionMode: SelectionModeTokenUsage[];
};

const VALID_WINDOWS: readonly TokenAccountingWindow[] = ["today", "7d", "30d"];

function isValidWindow(value: unknown): value is TokenAccountingWindow {
  return typeof value === "string" && (VALID_WINDOWS as readonly string[]).includes(value);
}

/**
 * Returns one OWNER-safe usage snapshot for the requested window.
 * `window` is `unknown` — this is the ONLY input this action accepts,
 * and it is validated against the closed `TokenAccountingWindow` set
 * BEFORE anything else runs. An invalid/forged value is REJECTED
 * outright (never silently coerced to "today" — a caller reaching this
 * action with a bad value is either a bug or a direct/forged call, and
 * hiding that behind a silent default would make it invisible). The
 * calling PAGE, not this action, is responsible for defaulting an
 * invalid URL query value to "today" for DISPLAY purposes — see
 * app/admin/owner/ai-governance/page.tsx.
 *
 * All six token-accounting.ts reads run concurrently (Promise.all) for
 * the one validated window — no sequential round-trips, no caching
 * layer, no daily-aggregate table (see the G3B architecture review for
 * why none of those are justified at this application's scale).
 */
export async function getRadarAiTokenGovernanceSnapshot(window: unknown): Promise<TokenGovernanceSnapshot> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");

  if (!isValidWindow(window)) {
    throw new Error(`invalid token governance window: expected one of ${VALID_WINDOWS.join(", ")}`);
  }

  const [totals, successfulAdvisories, successfulFallbackAdvisories, byProvider, byModel, bySelectionMode] = await Promise.all([
    getGlobalTokenUsage(window),
    getSuccessfulAdvisoryCount(window),
    getSuccessfulFallbackAdvisoryCount(window),
    getTokenUsageByProvider(window),
    getTokenUsageByModel(window),
    getTokenUsageBySelectionMode(window),
  ]);

  return {
    window,
    totals,
    successfulAdvisories,
    successfulFallbackAdvisories,
    byProvider,
    byModel,
    bySelectionMode,
  };
}
