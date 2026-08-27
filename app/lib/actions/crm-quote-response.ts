"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmQuotes } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { resolveQuoteByToken } from "@/lib/actions/crm-quote-access";
import type { QuoteAccessFailureReason } from "@/lib/quote-verification";

export type QuoteDecision = "accepted" | "declined";

export type QuoteResponseFailureReason = QuoteAccessFailureReason | "invalid_decision" | "not_eligible" | "conflicting_decision";

export type QuoteResponseResult = { ok: true; status: QuoteDecision; alreadyResponded: boolean } | { ok: false; reason: QuoteResponseFailureReason };

/**
 * Chantier 1 / Phase 4 — PUBLIC, no Clerk session, no staff role.
 * Authorization is entirely the token: exactly like resolveQuoteByToken
 * (called below as this function's sole identity check), possession of a
 * valid, non-revoked, non-expired token within the attempt budget is the
 * whole credential — the caller never supplies a quoteId, and the only
 * quote this function can ever mutate is the one resolveQuoteByToken
 * itself resolved from the token.
 *
 * Transition control lives entirely in the conditional UPDATE's WHERE
 * clause below, never in a separate read-then-decide step — this is what
 * makes two concurrent calls for the same quote race-safe: only one
 * UPDATE can ever match `status = 'sent'` (Postgres row-level locking
 * serializes them), so only one can ever flip it and only that one writes
 * the audit log. The follow-up SELECT, reached only when the UPDATE
 * matched zero rows, never decides whether to write anything — it only
 * classifies, for the response message, whether this was the same
 * decision repeated (idempotent success) or an illegitimate transition
 * (opposite decision already recorded, or the quote was never eligible:
 * still "draft" or already "expired").
 */
export async function respondToQuoteByToken(token: string, decision: string): Promise<QuoteResponseResult> {
  if (decision !== "accepted" && decision !== "declined") {
    return { ok: false, reason: "invalid_decision" };
  }

  const resolved = await resolveQuoteByToken(token);
  if (!resolved.ok) return resolved;

  const [updated] = await db
    .update(crmQuotes)
    .set({ status: decision, respondedAt: new Date() })
    .where(and(eq(crmQuotes.id, resolved.quote.id), eq(crmQuotes.status, "sent")))
    .returning();

  if (updated) {
    await logCrmAudit({
      action: decision === "accepted" ? "crm.quote_accepted" : "crm.quote_declined",
      targetType: "crm_quote",
      targetId: updated.id,
      clientId: updated.clientId,
      metadata: { quoteNumber: updated.quoteNumber },
    });
    revalidatePath("/admin/crm/quotes");
    revalidatePath(`/admin/crm/clients/${updated.clientId}`);
    return { ok: true, status: decision, alreadyResponded: false };
  }

  const [current] = await db.select({ status: crmQuotes.status }).from(crmQuotes).where(eq(crmQuotes.id, resolved.quote.id)).limit(1);

  if (current?.status === decision) {
    return { ok: true, status: decision, alreadyResponded: true };
  }
  if (current?.status === "accepted" || current?.status === "declined") {
    return { ok: false, reason: "conflicting_decision" };
  }
  return { ok: false, reason: "not_eligible" };
}
