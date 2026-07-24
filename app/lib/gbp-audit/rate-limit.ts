import "server-only";
import { sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditRateLimitHits } from "@/db/audit-schema";

export { clientIpFromHeaders } from "@/lib/gbp-audit/client-ip";

/**
 * Fixed-window DB-backed rate limiter for public, unauthenticated audit
 * surfaces (portal token resolution, PDF download, quote submission).
 * Deliberately simple (fixed window, not sliding/token-bucket) — good
 * enough to blunt brute-force token guessing and spam, not a general
 * traffic-shaping tool. See db/audit-schema.ts on auditRateLimitHits for
 * why this is DB-backed instead of an in-memory Map.
 */
export async function checkRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  const windowStartMs = Math.floor(now / (windowSeconds * 1000)) * (windowSeconds * 1000);
  const windowStart = new Date(windowStartMs);
  const key = `${scope}:${identifier}:${windowStartMs}`;

  const [row] = await auditDb
    .insert(auditRateLimitHits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: auditRateLimitHits.key,
      set: { count: sql`${auditRateLimitHits.count} + 1` },
    })
    .returning({ count: auditRateLimitHits.count });

  const retryAfterSeconds = Math.ceil((windowStartMs + windowSeconds * 1000 - now) / 1000);
  return { allowed: row.count <= limit, retryAfterSeconds };
}
