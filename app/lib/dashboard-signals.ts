/**
 * Pure, rule-based signal engine for the client dashboard's "Vos priorités"
 * / Next Best Action / Morning Brief / "Continuer" blocks (PHASE 1A).
 * Deliberately takes plain, already-fetched booleans/numbers/dates in and
 * returns plain data out — no DB access, no fetch, no locale text — so it
 * can be unit-tested without mocking anything and so the exact same rule
 * set can't drift between the three UI surfaces that read it.
 *
 * Every signal here must be backed by a real, already-queried value from
 * app/dashboard/page.tsx. Adding a new signal means adding a new input
 * field first — never inferring one from nothing.
 */

export type SignalKind =
  | "sync_error_gbp"
  | "sync_error_analytics"
  | "sync_error_search_console"
  | "gbp_not_connected"
  | "never_synced_gbp"
  | "never_synced_analytics"
  | "never_synced_search_console"
  | "onboarding_incomplete"
  | "no_audit_yet"
  | "pending_reviews"
  | "views_up";

export type Criticality = "critical" | "high" | "medium" | "opportunity";

export type DashboardSignal = {
  kind: SignalKind;
  criticality: Criticality;
  href: string;
  /** Only the numeric/percentage payload a label needs — never free text. */
  count?: number;
  pct?: number;
};

const CRITICALITY: Record<SignalKind, Criticality> = {
  sync_error_gbp: "critical",
  sync_error_analytics: "critical",
  sync_error_search_console: "critical",
  gbp_not_connected: "high",
  never_synced_gbp: "high",
  never_synced_analytics: "high",
  never_synced_search_console: "high",
  onboarding_incomplete: "high",
  no_audit_yet: "medium",
  pending_reviews: "medium",
  views_up: "opportunity",
};

// Fixed rank for Next Best Action — lower wins. Matches the order given in
// the approved plan exactly: critical integration error > missing
// connection > incomplete onboarding > important client action (pending
// reviews) > audit to review > measurable opportunity. Deliberately a
// SEPARATE ordering from the 4-tier `criticality` above (used for the
// "Vos priorités" list) — NBA needs one strict total order, priorities
// only need a coarse tier for grouping/sorting.
const NBA_RANK: Record<SignalKind, number> = {
  sync_error_gbp: 0,
  sync_error_analytics: 0,
  sync_error_search_console: 0,
  gbp_not_connected: 1,
  never_synced_gbp: 1,
  never_synced_analytics: 1,
  never_synced_search_console: 1,
  onboarding_incomplete: 2,
  pending_reviews: 3,
  no_audit_yet: 4,
  views_up: 5,
};

// Mirrors lib/google/oauth.ts's GoogleServiceOverview exactly (state is
// absent, not just falsy, when scopeGranted is false) so callers can pass
// getGoogleConnectionOverview()'s result straight through with no mapping.
export type GoogleProductState = {
  scopeGranted: boolean;
  state?: "ready_to_sync" | "synced" | "error";
  lastError?: string | null;
};

export type DashboardSignalInput = {
  isGbpConnected: boolean;
  onboardingCompleted: boolean;
  hasAudit: boolean;
  pendingReviewsCount: number;
  /** Null when there's no prior-period data to compare against — never fabricate a 0%. */
  viewsDeltaPct: number | null;
  google: {
    connected: boolean;
    gbp: GoogleProductState;
    analytics: GoogleProductState;
    searchConsole: GoogleProductState;
  };
};

const VIEWS_UP_THRESHOLD_PCT = 15;

export function computeDashboardSignals(input: DashboardSignalInput): DashboardSignal[] {
  const signals: DashboardSignal[] = [];

  const productSignal = (
    product: GoogleProductState,
    errorKind: SignalKind,
    neverSyncedKind: SignalKind,
    href: string,
  ) => {
    if (!input.google.connected || !product.scopeGranted) return;
    if (product.state === "error") {
      signals.push({ kind: errorKind, criticality: CRITICALITY[errorKind], href });
    } else if (product.state === "ready_to_sync") {
      signals.push({ kind: neverSyncedKind, criticality: CRITICALITY[neverSyncedKind], href });
    }
  };

  productSignal(input.google.gbp, "sync_error_gbp", "never_synced_gbp", "/dashboard/gbp");
  productSignal(input.google.analytics, "sync_error_analytics", "never_synced_analytics", "/dashboard/analytics");
  productSignal(input.google.searchConsole, "sync_error_search_console", "never_synced_search_console", "/dashboard/search-console");

  if (!input.isGbpConnected) {
    signals.push({ kind: "gbp_not_connected", criticality: CRITICALITY.gbp_not_connected, href: "/dashboard/gbp" });
  }
  if (!input.onboardingCompleted) {
    signals.push({ kind: "onboarding_incomplete", criticality: CRITICALITY.onboarding_incomplete, href: "/dashboard/onboarding" });
  }
  if (input.isGbpConnected && !input.hasAudit) {
    signals.push({ kind: "no_audit_yet", criticality: CRITICALITY.no_audit_yet, href: "/dashboard/audits" });
  }
  if (input.isGbpConnected && input.pendingReviewsCount > 0) {
    signals.push({ kind: "pending_reviews", criticality: CRITICALITY.pending_reviews, href: "/dashboard/gbp", count: input.pendingReviewsCount });
  }
  if (input.viewsDeltaPct !== null && input.viewsDeltaPct >= VIEWS_UP_THRESHOLD_PCT) {
    signals.push({ kind: "views_up", criticality: CRITICALITY.views_up, href: "/dashboard/gbp", pct: input.viewsDeltaPct });
  }

  return signals;
}

const PRIORITY_TIER_RANK: Record<Criticality, number> = { critical: 0, high: 1, medium: 2, opportunity: 3 };

/** "Vos priorités" — capped, critical first, opportunities last. */
export function pickTopPriorities(signals: DashboardSignal[], max = 5): DashboardSignal[] {
  return [...signals].sort((a, b) => PRIORITY_TIER_RANK[a.criticality] - PRIORITY_TIER_RANK[b.criticality]).slice(0, max);
}

/** Single Next Best Action — strict rank order, first match wins. Ties
 * within the same rank keep the order computeDashboardSignals produced
 * them in (stable sort), which itself always emits sync errors before
 * anything else. */
export function pickNextBestAction(signals: DashboardSignal[]): DashboardSignal | null {
  if (signals.length === 0) return null;
  return [...signals].sort((a, b) => NBA_RANK[a.kind] - NBA_RANK[b.kind])[0];
}

export type ContinueItem = { key: string; href: string };

/** "Continuer" — deliberately reuses the exact same already-computed
 * inputs as the signals above (no page-view/navigation tracking of any
 * kind, per the approved plan: build this only if it's cleanly derivable
 * from existing data). Framed as neutral shortcuts, not alerts — so it
 * intentionally omits sync-error items (those already lead in "Vos
 * priorités" / Next Best Action) and only offers positive/neutral
 * continuations. Capped at 3. */
export function buildContinueItems(input: DashboardSignalInput): ContinueItem[] {
  const items: ContinueItem[] = [];
  if (!input.onboardingCompleted) items.push({ key: "onboarding", href: "/dashboard/onboarding" });
  if (input.isGbpConnected && input.hasAudit) items.push({ key: "last_audit", href: "/dashboard/audits" });
  if (input.isGbpConnected) items.push({ key: "gbp", href: "/dashboard/gbp" });
  return items.slice(0, 3);
}

export type MorningBriefLine =
  | { kind: "priorities_count"; count: number }
  | { kind: "last_sync"; product: "gbp" | "analytics" | "search_console"; syncedAt: Date }
  | { kind: "views_up"; pct: number }
  | { kind: "public_map_actions_since_last_visit"; count: number };

/** Deterministic, rule-based — every line requires its own real data to
 * exist; nothing here ever renders a placeholder or guessed value. Order
 * is fixed: attention items first, then freshest real signal, then
 * positive news, then PUBLIC-MAP's own activity. Capped at 4 lines to
 * stay a "brief". */
export function buildMorningBrief(input: {
  prioritiesCount: number;
  mostRecentSync: { product: "gbp" | "analytics" | "search_console"; syncedAt: Date } | null;
  viewsDeltaPct: number | null;
  actionsSinceLastVisit: number | null;
}): MorningBriefLine[] {
  const lines: MorningBriefLine[] = [];
  if (input.prioritiesCount > 0) lines.push({ kind: "priorities_count", count: input.prioritiesCount });
  if (input.mostRecentSync) lines.push({ kind: "last_sync", product: input.mostRecentSync.product, syncedAt: input.mostRecentSync.syncedAt });
  if (input.viewsDeltaPct !== null && input.viewsDeltaPct >= VIEWS_UP_THRESHOLD_PCT) lines.push({ kind: "views_up", pct: input.viewsDeltaPct });
  if (input.actionsSinceLastVisit !== null && input.actionsSinceLastVisit > 0) {
    lines.push({ kind: "public_map_actions_since_last_visit", count: input.actionsSinceLastVisit });
  }
  return lines.slice(0, 4);
}
