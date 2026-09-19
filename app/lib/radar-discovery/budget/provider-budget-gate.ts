import "server-only";

/**
 * RADAR DISCOVERY ENGINE — MISSION C-2D-6-B — adapts discovery-budget-store.ts's
 * generic reserve/settle/release primitives into the narrow, per-HTTP-attempt
 * shape google-places-provider.ts's `search()`/`getDetails()` retry loop
 * needs (mission decision 7: "chaque tentative HTTP réelle... nouvelle
 * réservation").
 *
 * ONE gate instance is bound to ONE Server Action invocation's own actor
 * identity + correlation id — constructed by the Server Action (which
 * alone knows the resolved `userId`), never by configured-google-places.ts
 * (which has zero knowledge of who is calling). This is a deliberate
 * asymmetry versus checkRateLimit/checkEnrichmentRateLimit's own
 * lazily-resolved DB-backed defaults: a rate-limit check needs no actor
 * identity to attribute an audit entry to, a budget reservation does.
 *
 * LAZY IMPORT (mirrors rate-limit-gate.ts's own documented discipline,
 * google-places-provider.ts's import comment): discovery-budget-store.ts
 * imports `@/db` at its own top level, which throws at MODULE LOAD TIME
 * (not call time) when DATABASE_URL is unset. `createProviderBudgetGate()`
 * is called unconditionally by both lib/actions/radar-discovery-search.ts
 * and lib/actions/radar-discovery-enrich.ts, so a plain top-level
 * `import { reserveBudget, ... } from "./discovery-budget-store"` here
 * would force every unit test of those two Server Actions (which mock
 * @/db-touching modules away entirely, never setting DATABASE_URL) to
 * fail merely by importing the action file. The dynamic imports below
 * defer that cost to the first ACTUAL `.reserve()`/`.settle()` call,
 * exactly like google-places-provider.ts's own `checkRateLimit` default
 * resolution.
 */
import { randomUUID } from "node:crypto";
import type { DiscoveryBudgetOperationType } from "./types";

export type ProviderBudgetErrorCode = "BUDGET_EXHAUSTED" | "BUDGET_BLOCKED" | "BUDGET_PRICE_UNKNOWN";

export type ProviderBudgetReserveResult = { allowed: true; reservationId: string } | { allowed: false; errorCode: ProviderBudgetErrorCode };

/** The exact shape google-places-provider.ts's retry loop consults before
 * EACH HTTP attempt (including a retry) and settles/releases immediately
 * after that SAME attempt resolves — never a single reservation spanning
 * more than one HTTP attempt. */
export type ProviderBudgetGate = {
  reserve: (attemptNumber: number) => Promise<ProviderBudgetReserveResult>;
  settle: (reservationId: string, success: boolean) => Promise<void>;
};

export type CreateProviderBudgetGateOptions = {
  operationType: DiscoveryBudgetOperationType;
  actorUserId: string;
  provider: string;
  priceOperation: "search" | "get_details";
  fieldSet: string;
  /** A fresh, unique id per Server Action invocation (never reused across
   * two different search()/getDetails() calls) — combined with the
   * attempt number to form each attempt's own idempotency key, so a
   * genuine application-level retry of the WHOLE server action (a new
   * correlationId) never collides with a prior invocation's reservations,
   * while a retry WITHIN one invocation's own attempt loop (same
   * correlationId, incremented attemptNumber) always reserves fresh. */
  correlationId?: string;
};

export function createProviderBudgetGate(options: CreateProviderBudgetGateOptions): ProviderBudgetGate {
  const correlationId = options.correlationId ?? randomUUID();

  return {
    async reserve(attemptNumber: number): Promise<ProviderBudgetReserveResult> {
      const { reserveBudget } = await import("./discovery-budget-store");
      const outcome = await reserveBudget({
        operationType: options.operationType,
        amount: 1,
        idempotencyKey: `${correlationId}:attempt:${attemptNumber}`,
        actorUserId: options.actorUserId,
        provider: options.provider,
        priceOperation: options.priceOperation,
        fieldSet: options.fieldSet,
      });

      if (outcome.status === "reserved" || outcome.status === "already_reserved") {
        return { allowed: true, reservationId: outcome.reservation.id };
      }
      if (outcome.status === "price_unknown") return { allowed: false, errorCode: "BUDGET_PRICE_UNKNOWN" };
      if (outcome.status === "blocked") return { allowed: false, errorCode: "BUDGET_BLOCKED" };
      // "exhausted" | "not_provisioned" — both mean "no spendable budget
      // right now"; BUDGET_EXHAUSTED is the correct caller-facing signal
      // for either (a never-provisioned period is not spendable either,
      // and the DiscoveryError taxonomy has no separate "not provisioned"
      // code — mission decision 12 treats both as a refusal, never a
      // distinction the caller needs to react to differently).
      return { allowed: false, errorCode: "BUDGET_EXHAUSTED" };
    },

    async settle(reservationId: string, success: boolean): Promise<void> {
      const { releaseBudget, settleBudget } = await import("./discovery-budget-store");
      if (success) {
        await settleBudget(reservationId, 1, options.actorUserId);
      } else {
        await releaseBudget(reservationId, options.actorUserId);
      }
    },
  };
}
