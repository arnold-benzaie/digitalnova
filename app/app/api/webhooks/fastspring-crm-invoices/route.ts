import { verifyFastspringSignature } from "@/lib/billing/webhook";
import { adaptFastSpringOrderCompleted, type FastSpringOrderCompletedFixture } from "@/lib/billing/crm-fastspring-adapter";
import { markCrmInvoicePaidFromPaymentEvent } from "@/lib/billing/crm-invoice-webhook";

/**
 * Chantier 2 / Phase 5B — CRM invoice payment webhook. Deliberately
 * separate from app/api/webhooks/fastspring/route.ts (the platform's own
 * subscription-billing webhook, untouched by this file) — domain A
 * (platform) and domain B (CRM client invoices) never share a route, a
 * secret, or a processing loop, per the Chantier 2 Phase 2/5 audits.
 *
 * Uses its own env var, FASTSPRING_CRM_WEBHOOK_SECRET — never the
 * platform's FASTSPRING_WEBHOOK_SECRET. Not configured anywhere yet (no
 * real FastSpring account exists for this domain) — this route fails
 * closed (500) until it is.
 *
 * Order of operations is fixed and load-bearing: raw body first, then the
 * signature header, then the secret, then the signature check — all
 * BEFORE any JSON.parse. The signature is verified against the exact raw
 * bytes/text FastSpring sent, never a re-serialized JSON.stringify of a
 * parsed object (which can silently disagree byte-for-byte with what was
 * actually signed). Only once the signature is confirmed valid does the
 * body ever get parsed, and only once parsed does it ever reach the
 * Phase 5A adapter and the Phase 4 engine — this route never reconstructs
 * a CrmInvoicePaymentEvent by hand, never touches crmInvoices directly,
 * and never writes its own "paid" audit entry: markCrmInvoicePaidFromPaymentEvent
 * remains the sole authority for both.
 *
 * HTTP policy: 500 only for a genuinely unexpected internal failure
 * (missing secret configuration, an unhandled exception) — the only
 * cases where letting FastSpring retry later is meaningful. Every data
 * problem (malformed JSON is the one exception, at 400; every adapter or
 * engine rejection reason) is ACKed with 200, because retrying the exact
 * same payload can never fix a permanent mismatch/conflict/ineligible
 * state — the anomaly is visible via the response body and, for the one
 * case that matters financially, Phase 4's own real "paid" audit is the
 * source of truth, not a parallel logging system introduced here.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-fs-signature");
  const secret = process.env.FASTSPRING_CRM_WEBHOOK_SECRET;

  if (!secret) {
    return Response.json({ ok: false, reason: "server_not_configured" }, { status: 500 });
  }

  const verified = verifyFastspringSignature(rawBody, signatureHeader, secret);
  if (!verified) {
    return Response.json({ ok: false, reason: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }

  try {
    const adapted = adaptFastSpringOrderCompleted(payload as FastSpringOrderCompletedFixture);
    if (!adapted.ok) {
      return Response.json({ ok: false, reason: adapted.reason }, { status: 200 });
    }

    const result = await markCrmInvoicePaidFromPaymentEvent(adapted.event);
    if (!result.ok) {
      return Response.json({ ok: false, reason: result.reason }, { status: 200 });
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json({ ok: false, reason: "internal_error" }, { status: 500 });
  }
}
