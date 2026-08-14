import type { Plan } from "@/lib/billing/types";
import type { Market } from "@/lib/market/context";
import { resolveMarketContext } from "@/lib/market/context";

/**
 * The market selects which price of an EXISTING plan to show — it never
 * invents or converts one. A Canadian organization sees `plan.priceCad`;
 * if that plan doesn't have one yet (see lib/billing/mock-provider.ts's
 * own comment — no real CAD price has been confirmed for any plan yet),
 * this returns `pending: true` rather than falling back to the EUR price
 * or guessing a converted amount. An organization with no market set
 * (`market: null`) also gets `pending: true` — pricing must never default
 * to a currency the organization never chose.
 */
export type ResolvedPlanPrice = { amount: number; currency: "EUR" | "CAD"; pending: false } | { amount: null; currency: "EUR" | "CAD" | null; pending: true };

export function resolvePlanPrice(plan: Plan, market: Market | null): ResolvedPlanPrice {
  const context = resolveMarketContext(market);
  if (!context) return { amount: null, currency: null, pending: true };

  if (context.currency === "EUR") {
    return { amount: plan.priceEuros, currency: "EUR", pending: false };
  }
  if (plan.priceCad === null) {
    return { amount: null, currency: "CAD", pending: true };
  }
  return { amount: plan.priceCad, currency: "CAD", pending: false };
}
