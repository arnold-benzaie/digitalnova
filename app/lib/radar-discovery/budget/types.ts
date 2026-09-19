/**
 * RADAR DISCOVERY ENGINE — MISSION C-2D-6-B — Cost & Quota Governance —
 * shared types. Pure type definitions, zero DB/network access, mirroring
 * lib/radar-discovery/types.ts's own role for the Discovery domain proper.
 *
 * SCOPE (mission decisions 3/15-19): Search and Enrichment are the ONLY
 * two `DiscoveryBudgetOperationType` values in this mission — no World
 * Job, no Geo Strategy, no Provider Router, no second provider. `country`/
 * `region`/`city`/`zone` exist ONLY as optional ledger reporting
 * dimensions (never a reservation scope) — see discovery-budget-store.ts's
 * own header.
 */

/** The two, and only two, budget-governed Discovery operations. Search and
 * Enrichment NEVER share a budget row, a reservation, or a Price Catalog
 * lookup — same separation already established for rate-limit scopes
 * (rate-limit-gate.ts / actor-rate-limit.ts), for the identical reason. */
export const DISCOVERY_BUDGET_OPERATION_TYPES = ["search", "enrichment"] as const;
export type DiscoveryBudgetOperationType = (typeof DISCOVERY_BUDGET_OPERATION_TYPES)[number];

export const DISCOVERY_BUDGET_PERIOD_TYPES = ["month", "day"] as const;
export type DiscoveryBudgetPeriodType = (typeof DISCOVERY_BUDGET_PERIOD_TYPES)[number];

/** Derived, never stored as a column value beyond `blocked` (see
 * discovery-budget-store.ts's own header on why AVAILABLE/LOW/EXHAUSTED
 * are computed at read time from `remaining`/`allocated`/
 * `warningThresholdPercent`, never a separately persisted, potentially
 * stale `status` string). */
export const DISCOVERY_BUDGET_STATUSES = ["available", "low", "exhausted", "blocked"] as const;
export type DiscoveryBudgetStatus = (typeof DISCOVERY_BUDGET_STATUSES)[number];

export const DISCOVERY_BUDGET_RESERVATION_STATUSES = ["active", "settled", "released", "expired"] as const;
export type DiscoveryBudgetReservationStatus = (typeof DISCOVERY_BUDGET_RESERVATION_STATUSES)[number];

export const DISCOVERY_BUDGET_LEDGER_MOVEMENT_TYPES = ["reserve", "settle", "release", "adjust", "expire"] as const;
export type DiscoveryBudgetLedgerMovementType = (typeof DISCOVERY_BUDGET_LEDGER_MOVEMENT_TYPES)[number];

/** One (operationType, periodType, periodKey) balance row's public shape. */
export type DiscoveryBudgetSnapshot = {
  id: string;
  operationType: DiscoveryBudgetOperationType;
  periodType: DiscoveryBudgetPeriodType;
  periodKey: string;
  allocated: number;
  remaining: number;
  warningThresholdPercent: number;
  blocked: boolean;
  status: DiscoveryBudgetStatus;
};

/** Resolved, UTC-derived scope for one reservation attempt — computed
 * server-side ONLY (never accepted from a caller), mirrors
 * `currentGlobalQuotaKey()`'s own "resolved from `now`, never from
 * input" discipline. */
export type DiscoveryBudgetScope = {
  operationType: DiscoveryBudgetOperationType;
  monthPeriodKey: string;
  dayPeriodKey: string;
};

/** Optional, reporting-only dimensions a ledger row may carry — see
 * discovery-budget-store.ts's own header: these NEVER become a
 * reservation/budget scope, only metadata for a future cost-by-country/
 * region/city/zone report. */
export type DiscoveryBudgetLedgerDimensions = {
  provider?: string | null;
  relatedEntity?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  zone?: string | null;
};

export type DiscoveryBudgetReservationSnapshot = {
  id: string;
  idempotencyKey: string;
  operationType: DiscoveryBudgetOperationType;
  monthPeriodKey: string;
  dayPeriodKey: string;
  amount: number;
  actualAmount: number | null;
  status: DiscoveryBudgetReservationStatus;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
};

export type ReserveBudgetOutcome =
  | { status: "reserved"; reservation: DiscoveryBudgetReservationSnapshot }
  /** The SAME idempotencyKey was already used for a reservation that
   * completed (in ANY terminal or active state) — the caller gets back
   * that EXISTING reservation, verbatim, never a second decrement. */
  | { status: "already_reserved"; reservation: DiscoveryBudgetReservationSnapshot }
  | { status: "exhausted"; scope: DiscoveryBudgetPeriodType }
  | { status: "blocked"; scope: DiscoveryBudgetPeriodType }
  /** No budget row exists yet for the current period — see
   * discovery-budget-store.ts's own header on why this is FAIL-CLOSED,
   * never an implicit "unlimited". */
  | { status: "not_provisioned"; scope: DiscoveryBudgetPeriodType }
  | { status: "price_unknown" };

export type SettleBudgetOutcome = { status: "settled"; reservation: DiscoveryBudgetReservationSnapshot } | { status: "already_settled"; reservation: DiscoveryBudgetReservationSnapshot } | { status: "not_active" };

export type ReleaseBudgetOutcome = { status: "released"; reservation: DiscoveryBudgetReservationSnapshot } | { status: "already_released"; reservation: DiscoveryBudgetReservationSnapshot } | { status: "not_active" };

export type ResolvedPrice = {
  catalogEntryId: string;
  provider: string;
  sku: string;
  operation: string;
  fieldSet: string;
  unit: string;
  price: number;
  currency: string;
};

export type ResolvePriceOutcome = { status: "known"; price: ResolvedPrice } | { status: "unknown" };
