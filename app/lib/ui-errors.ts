import "server-only";
import { and, eq, gte, isNotNull, ne, desc } from "drizzle-orm";
import { db } from "@/db";
import { systemHealthChecks } from "@/db/schema";
import { sendUiAlertEmail } from "@/lib/email/ui-alert";

/**
 * "General UI/Server Action errors are failing repeatedly" alerting — a
 * sibling to lib/system-alerts.ts (service: "database") and
 * lib/chat/technical-alert.ts (service: "chat_ai"), not a modification
 * of either: this file introduces its own `service: "ui"` row and its
 * own alert path, so the already-working DB and chat_ai thresholds,
 * cooldowns and email content are untouched. Shares the same two real
 * primitives instead of duplicating them: the generic `systemHealthChecks`
 * table and the Resend wrapper pattern (via lib/email/ui-alert.ts).
 *
 * Deliberately reuses chat_ai's window/threshold/cooldown values for
 * consistency across the two sibling alert paths — no new tuning, no
 * new constants to justify.
 *
 * Never throws — called fire-and-forget from the Server Action bridge
 * in lib/actions/report-ui-error.ts, which itself must never fail the
 * caller regardless of whether alerting succeeds.
 */
const SERVICE = "ui";
const WINDOW_MINUTES = 10;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60 * 60 * 1000;

function environmentLabel(): string {
  return process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
}

export async function recordUiFailureAndMaybeAlert(errorCategory: string, route: string): Promise<void> {
  try {
    const [inserted] = await db.insert(systemHealthChecks).values({ service: SERVICE, status: "unhealthy", errorCategory }).returning({ id: systemHealthChecks.id });

    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
    const recentFailures = await db
      .select({ id: systemHealthChecks.id })
      .from(systemHealthChecks)
      .where(and(eq(systemHealthChecks.service, SERVICE), ne(systemHealthChecks.status, "healthy"), gte(systemHealthChecks.createdAt, windowStart)));

    if (recentFailures.length < FAILURE_THRESHOLD) return;

    const [lastAlert] = await db
      .select({ alertSentAt: systemHealthChecks.alertSentAt })
      .from(systemHealthChecks)
      .where(and(eq(systemHealthChecks.service, SERVICE), isNotNull(systemHealthChecks.alertSentAt)))
      .orderBy(desc(systemHealthChecks.createdAt))
      .limit(1);

    if (lastAlert?.alertSentAt && Date.now() - lastAlert.alertSentAt.getTime() < COOLDOWN_MS) return;

    const result = await sendUiAlertEmail({
      environment: environmentLabel(),
      errorCategory,
      occurrences: recentFailures.length,
      windowMinutes: WINDOW_MINUTES,
      route,
    });

    if (result.sent && inserted) {
      await db.update(systemHealthChecks).set({ alertSentAt: new Date() }).where(eq(systemHealthChecks.id, inserted.id));
    }
  } catch {
    console.error("[ui] Échec de l'enregistrement/alerte technique (non bloquant).");
  }
}
