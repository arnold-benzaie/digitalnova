import "server-only";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { systemHealthChecks } from "@/db/schema";
import { sendSystemAlertEmail } from "@/lib/email/system-alert";
import type { DbErrorCategory } from "@/lib/db-transient-error";
import type { HealthStatus } from "@/lib/system-health";

const COOLDOWN_MS = 60 * 60 * 1000; // 1 alert per error category per hour, max

function alertRecipients(): string[] {
  const raw = process.env.SYSTEM_ALERT_EMAIL;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function environmentLabel(): string {
  return process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
}

/** Was there a prior, still-open outage that we already emailed about?
 * Walks back through consecutive non-healthy rows (most recent first) —
 * stops at the first "healthy" row — and reports whether any of that
 * streak has `alertSentAt` set. */
async function findAnnouncedOutage(): Promise<boolean> {
  const recent = await db
    .select({ status: systemHealthChecks.status, alertSentAt: systemHealthChecks.alertSentAt })
    .from(systemHealthChecks)
    .where(eq(systemHealthChecks.service, "database"))
    .orderBy(desc(systemHealthChecks.createdAt))
    .limit(10);

  for (const row of recent) {
    if (row.status === "healthy") return false;
    if (row.alertSentAt) return true;
  }
  return false;
}

/** Cooldown check: was an alert for this exact error category already
 * sent within the last hour? */
async function withinCooldown(errorCategory: DbErrorCategory): Promise<boolean> {
  const [last] = await db
    .select({ alertSentAt: systemHealthChecks.alertSentAt })
    .from(systemHealthChecks)
    .where(
      and(
        eq(systemHealthChecks.service, "database"),
        eq(systemHealthChecks.errorCategory, errorCategory),
        isNotNull(systemHealthChecks.alertSentAt),
        ne(systemHealthChecks.status, "healthy"),
      ),
    )
    .orderBy(desc(systemHealthChecks.createdAt))
    .limit(1);

  if (!last?.alertSentAt) return false;
  return Date.now() - last.alertSentAt.getTime() < COOLDOWN_MS;
}

/**
 * Decides whether an alert or recovery email should actually go out right
 * now (cooldown + recovery-only-if-announced), sends it via the single
 * Resend wrapper if so, and reports back whether to stamp `alertSentAt` on
 * the row about to be inserted. Never throws — a broken alert channel must
 * never break the health check itself.
 */
export async function dispatchSystemAlert(input: {
  status: HealthStatus;
  latencyMs: number | null;
  errorCode: string | null;
  errorCategory: DbErrorCategory | null;
  consecutiveFailures: number;
  shouldAlert: boolean;
}): Promise<{ alertSent: boolean }> {
  try {
    const recipients = alertRecipients();

    if (input.status === "healthy") {
      const wasAnnounced = await findAnnouncedOutage();
      if (!wasAnnounced) return { alertSent: false };
      const result = await sendSystemAlertEmail({
        to: recipients,
        locale: "fr",
        kind: "recovered",
        service: "database",
        environment: environmentLabel(),
      });
      return { alertSent: result.sent };
    }

    if (!input.shouldAlert || !input.errorCategory) return { alertSent: false };
    if (await withinCooldown(input.errorCategory)) return { alertSent: false };

    const result = await sendSystemAlertEmail({
      to: recipients,
      locale: "fr",
      kind: "alert",
      service: "database",
      errorCategory: input.errorCategory,
      errorCode: input.errorCode,
      latencyMs: input.latencyMs,
      consecutiveFailures: input.consecutiveFailures,
      environment: environmentLabel(),
    });
    return { alertSent: result.sent };
  } catch {
    // Alerting must never take down the health check it's reporting on.
    return { alertSent: false };
  }
}
