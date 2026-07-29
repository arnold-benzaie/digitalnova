import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { integrationApiRateLimitHits } from "@/db/schema";

/**
 * Fixed-window DB-backed rate limiter for /api/v1 — same technique as
 * lib/gbp-audit/rate-limit.ts (good enough to blunt abuse, not a
 * sliding-window/token-bucket traffic shaper), but against the main
 * schema's own `integration_api_rate_limit_hits` rather than the
 * separate Audit Supabase project's table; the two are never shared.
 *
 * A single atomic `INSERT ... ON CONFLICT DO UPDATE` both creates and
 * increments the window's counter — no read-then-write race between
 * concurrent requests in the same window.
 */

export type RateLimitCheck = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

export async function checkRateLimit(scope: string, identifier: string, limit: number, windowSeconds: number): Promise<RateLimitCheck> {
  const now = Date.now();
  const windowStartMs = Math.floor(now / (windowSeconds * 1000)) * (windowSeconds * 1000);
  const windowStart = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + windowSeconds * 1000);
  const key = `${scope}:${identifier}:${windowStartMs}`;

  const [row] = await db
    .insert(integrationApiRateLimitHits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: integrationApiRateLimitHits.key,
      set: { count: sql`${integrationApiRateLimitHits.count} + 1` },
    })
    .returning({ count: integrationApiRateLimitHits.count });

  const retryAfterSeconds = Math.max(0, Math.ceil((resetAt.getTime() - now) / 1000));
  return {
    allowed: row.count <= limit,
    limit,
    remaining: Math.max(0, limit - row.count),
    resetAt,
    retryAfterSeconds,
  };
}

/** Builds the standard X-RateLimit-* and X-Quota-* headers from both
 * window checks — used on EVERY /api/v1 response, success or error, so a
 * caller always knows where it stands without a separate call. */
export function buildUsageHeaders(perMinute: RateLimitCheck, perDay: RateLimitCheck): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(perMinute.limit),
    "X-RateLimit-Remaining": String(perMinute.remaining),
    "X-RateLimit-Reset": String(Math.floor(perMinute.resetAt.getTime() / 1000)),
    "X-Quota-Limit": String(perDay.limit),
    "X-Quota-Remaining": String(perDay.remaining),
    "X-Quota-Reset": String(Math.floor(perDay.resetAt.getTime() / 1000)),
  };
}
