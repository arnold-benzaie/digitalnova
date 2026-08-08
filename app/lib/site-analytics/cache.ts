import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteAnalyticsCache } from "@/db/schema";
import { fetchTrafficAnalyticsFromGa4 } from "./provider";
import type { SiteTrafficAnalytics } from "./types";

const TTL_MS = 5 * 60 * 1000;
const DASHBOARD_CACHE_KEY = "site_analytics:dashboard";

/**
 * Single cache entry for the whole dashboard payload (not per-metric) —
 * every card/chart on /admin/analytics is refetched together anyway, so
 * one key keeps this simple while still satisfying the "cache + 5-minute
 * refresh" requirement. Freshness is checked on read; a stale or missing
 * row triggers exactly one fresh GA4 fetch, whose result is upserted
 * before returning.
 */
export async function getCachedTrafficAnalytics(): Promise<SiteTrafficAnalytics> {
  const [existing] = await db.select().from(siteAnalyticsCache).where(eq(siteAnalyticsCache.cacheKey, DASHBOARD_CACHE_KEY)).limit(1);

  if (existing && Date.now() - existing.fetchedAt.getTime() < TTL_MS) {
    return existing.payload as SiteTrafficAnalytics;
  }

  const fresh = await fetchTrafficAnalyticsFromGa4();

  // Don't overwrite a previously-good cached payload with a transient
  // failure — keep serving the last known-good data (even if slightly
  // stale) rather than flipping the whole dashboard to "unavailable" for
  // a momentary GA4 API hiccup.
  if (fresh.unavailableReason && existing) {
    return existing.payload as SiteTrafficAnalytics;
  }

  await db
    .insert(siteAnalyticsCache)
    .values({ cacheKey: DASHBOARD_CACHE_KEY, payload: fresh, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: siteAnalyticsCache.cacheKey,
      set: { payload: fresh, fetchedAt: new Date() },
    });

  return fresh;
}
