import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { systemHealthChecks } from "@/db/schema";
import { classifyDbError, type DbErrorCategory } from "@/lib/db-transient-error";
import { dispatchSystemAlert } from "@/lib/system-alerts";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

// Calibrated against real measured latency to this Supabase project (see
// the EMAXCONNSESSION investigation): a warm pooled connection is
// typically ~200ms, a fresh/cold one closer to ~1.1s. Not universal —
// re-measure if the DB region or pooler configuration ever changes.
const LATENCY_HEALTHY_MS = 500;
const LATENCY_DEGRADED_MS = 1500;

const RETENTION_DAYS = 30;

// 2 consecutive non-healthy checks (this one + the prior one) triggers an
// alert even for an otherwise-ordinary connection error; a single isolated
// failure is recorded but not alerted on.
const CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 2;

export type HealthCheckResult = {
  status: HealthStatus;
  latencyMs: number | null;
  errorCode: string | null;
  errorCategory: DbErrorCategory | null;
  timestamp: string;
};

function statusFromLatency(latencyMs: number): HealthStatus {
  if (latencyMs < LATENCY_HEALTHY_MS) return "healthy";
  if (latencyMs < LATENCY_DEGRADED_MS) return "degraded";
  return "unhealthy";
}

/**
 * The only DB work this performs: SELECT 1 (connectivity + round-trip
 * latency) and one more trivially cheap read (row-count style, no table
 * scan) — never a mutation, never anything that could itself contend for
 * connections under pressure.
 */
async function probeDatabase(): Promise<{ latencyMs: number } | { error: unknown }> {
  const start = Date.now();
  try {
    await db.execute(sql`select 1`);
    await db.execute(sql`select 1 from system_health_checks limit 1`);
    return { latencyMs: Date.now() - start };
  } catch (error) {
    return { error };
  }
}

async function recentConsecutiveFailures(): Promise<number> {
  const recent = await db
    .select({ status: systemHealthChecks.status })
    .from(systemHealthChecks)
    .where(eq(systemHealthChecks.service, "database"))
    .orderBy(desc(systemHealthChecks.createdAt))
    .limit(10);
  let count = 0;
  for (const row of recent) {
    if (row.status === "healthy") break;
    count++;
  }
  return count;
}

async function purgeOldChecks() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.delete(systemHealthChecks).where(and(eq(systemHealthChecks.service, "database"), lt(systemHealthChecks.createdAt, cutoff)));
}

/**
 * Single entry point for the Vercel Cron route: probe, classify, persist,
 * decide+dispatch an alert if warranted, purge old rows, return a safe
 * summary (no connection details, no stack traces).
 */
export async function runDatabaseHealthCheck(): Promise<HealthCheckResult> {
  const probe = await probeDatabase();
  const timestamp = new Date().toISOString();

  let status: HealthStatus;
  let latencyMs: number | null = null;
  let errorCode: string | null = null;
  let errorCategory: DbErrorCategory | null = null;

  if ("latencyMs" in probe) {
    latencyMs = probe.latencyMs;
    status = statusFromLatency(latencyMs);
  } else {
    const classified = classifyDbError(probe.error);
    errorCode = classified.code;
    errorCategory = classified.category;
    status = "unhealthy";
  }

  const priorConsecutiveFailures = status === "healthy" ? 0 : await recentConsecutiveFailures();
  const consecutiveFailuresIncludingThis = status === "healthy" ? 0 : priorConsecutiveFailures + 1;

  const shouldAlert =
    status !== "healthy" &&
    (errorCategory === "connection_exhausted" || consecutiveFailuresIncludingThis >= CONSECUTIVE_FAILURE_ALERT_THRESHOLD);

  const alertOutcome = await dispatchSystemAlert({
    status,
    latencyMs,
    errorCode,
    errorCategory,
    consecutiveFailures: consecutiveFailuresIncludingThis,
    shouldAlert,
  });

  await db.insert(systemHealthChecks).values({
    service: "database",
    status,
    latencyMs,
    errorCode,
    errorCategory,
    alertSentAt: alertOutcome.alertSent ? new Date() : null,
  });

  // Best-effort housekeeping — never let retention cleanup fail the check
  // itself (it isn't the reason this route exists).
  await purgeOldChecks().catch(() => {});

  return { status, latencyMs, errorCode, errorCategory, timestamp };
}
