import "server-only";
import { and, eq, gte, isNotNull, ne, desc } from "drizzle-orm";
import { db } from "@/db";
import { systemHealthChecks } from "@/db/schema";
import { sendChatAlertEmail } from "@/lib/email/chat-alert";

/**
 * "The AI assistant is failing repeatedly" alerting (§10) — a sibling to
 * lib/system-alerts.ts, not a modification of it: that file's decision
 * inputs (consecutive-failure streak from a health-check cron) are
 * genuinely different from this one (failure rate over a rolling
 * window, triggered inline from app/api/chat/route.ts's own catch
 * block), so keeping them separate avoids any risk to the already-
 * working, already-tested DB alerting path. Both share the same two
 * real primitives instead of duplicating them: the `systemHealthChecks`
 * table (fully generic — `service` is free text, "chat_ai" here vs
 * "database" there) and the single Resend wrapper (via
 * lib/email/chat-alert.ts).
 *
 * Never sends on an isolated error — only once failures cluster within
 * a short window, then at most once per cooldown, exactly per §10's
 * explicit requirement.
 */
const SERVICE = "chat_ai";
const WINDOW_MINUTES = 10;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 alert per hour, max — same cooldown as DB alerting.

function environmentLabel(): string {
  return process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
}

/**
 * Categorizes a raw thrown error into one of a small, safe set of
 * labels for both the health-check row and the alert email — never the
 * raw error message (could echo request/URL/header details), matching
 * the same discipline as every other error-facing log line in this
 * codebase.
 */
export function categorizeChatError(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (/invalid_json|schema_validation_failed/.test(message)) return "invalid_json";
  if (/empty content|empty output_text/.test(message)) return "empty_response";
  if (/API_KEY is not configured/.test(message)) return "misconfigured";
  if (/timeout/i.test(message)) return "timeout";
  return "provider_unavailable";
}

/**
 * Records one chat-provider failure and, at most once per cooldown
 * window, sends a single technical alert once failures cluster. Never
 * throws — called from app/api/chat/route.ts's existing catch block,
 * which must still return its 502 regardless of whether alerting itself
 * succeeds.
 */
export async function recordChatFailureAndMaybeAlert(errorCategory: string, route: string): Promise<void> {
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

    const result = await sendChatAlertEmail({
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
    console.error("[chat] Échec de l'enregistrement/alerte technique (non bloquant).");
  }
}
