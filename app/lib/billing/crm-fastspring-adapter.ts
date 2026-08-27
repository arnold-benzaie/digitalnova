import { isValidUuid } from "@/lib/api-v1/dto";
import { CURRENCY_VALUES } from "@/lib/crm-billing";
import type { CrmInvoicePaymentEvent } from "@/lib/billing/crm-invoice-webhook";

/**
 * Chantier 2 / Phase 5A — translates a raw FastSpring `order.completed`
 * payload into the canonical CrmInvoicePaymentEvent the Phase 4 engine
 * (markCrmInvoicePaidFromPaymentEvent, lib/billing/crm-invoice-webhook.ts)
 * already expects and has already been tested against. Every
 * provider-shape assumption is isolated in this one file on purpose — if
 * FastSpring's real field names ever turn out to differ once a real
 * account exists, only this file needs to change, never the engine.
 *
 * Does NOT verify HTTP signature, does NOT read FASTSPRING_WEBHOOK_SECRET,
 * does NOT touch Request/Response — that is Phase 5B's job. This is pure
 * payload translation: synchronous, no I/O, no network, no database.
 */

const SUPPORTED_EVENT_TYPES = ["order.completed"];

/**
 * FIXTURE SHAPE — a minimal stand-in for FastSpring's real
 * `order.completed` payload. Confirmed against FastSpring's current
 * documentation (Chantier 2 Phase 5 authorization): order-level tags are
 * supported and the current Sessions API round-trips them as
 * `orderTags` (Sessions v1's `tags` is legacy, deliberately not used
 * here). The order identifier field (`order`), total field (`total`),
 * and currency field (`currency`) below follow this codebase's own
 * existing, already-used-but-still UNCONFIRMED assumption (see
 * app/api/webhooks/fastspring/route.ts's `event.data?.order`) — NOT
 * independently verified against a real payload. FastSpring payload
 * field mapping must be verified against the production order.completed
 * webhook schema before enabling the public CRM webhook. Update this
 * type, and only this type, once a real payload is observed.
 */
export type FastSpringOrderCompletedFixture = {
  type: string;
  data?: {
    order?: unknown;
    total?: unknown;
    currency?: unknown;
    orderTags?: Record<string, unknown>;
  };
};

export type CrmFastSpringAdapterFailureReason =
  | "unsupported_event_type"
  | "invalid_invoice_id"
  | "invalid_reference"
  | "invalid_amount"
  | "invalid_currency"
  | "invalid_payload";

export type CrmFastSpringAdapterResult = { ok: true; event: CrmInvoicePaymentEvent } | { ok: false; reason: CrmFastSpringAdapterFailureReason };

/**
 * Deterministic decimal-string -> integer-cents conversion. Same safe
 * pattern already established in lib/crm-billing.ts's priceStringToCents
 * (never `Number(value) * 100`, which drifts — "49.99" * 100 →
 * 4998.999999999999 before rounding silently masks it) — reimplemented
 * locally here, deliberately not imported, so this payment adapter's
 * money parsing never depends on a Catalogue-labeled utility. Accepts at
 * most 2 decimal digits; anything else (more precision, non-numeric,
 * negative, empty, "Infinity"/"NaN" as literal text) returns null rather
 * than silently rounding or coercing.
 */
function decimalStringToCents(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Translates one already-parsed FastSpring `order.completed` event into
 * a CrmInvoicePaymentEvent, or a typed failure reason — never throws for
 * ordinary bad/missing provider data (only a genuine programming error
 * elsewhere would ever surface as an exception). Produces no side effect
 * of any kind: no DB read, no DB write, no network call.
 */
export function adaptFastSpringOrderCompleted(payload: FastSpringOrderCompletedFixture): CrmFastSpringAdapterResult {
  if (!payload || typeof payload.type !== "string") {
    return { ok: false, reason: "invalid_payload" };
  }
  if (!SUPPORTED_EVENT_TYPES.includes(payload.type)) {
    return { ok: false, reason: "unsupported_event_type" };
  }

  // crmInvoiceId is the ONE piece of data PUBLIC-MAP itself placed on the
  // order (as an order tag, at checkout-creation time, Phase 5C+) — never
  // derived from anything the provider or the customer supplied on their
  // own (email, product, amount, providerReference).
  const rawInvoiceId = payload.data?.orderTags?.crmInvoiceId;
  if (typeof rawInvoiceId !== "string") {
    return { ok: false, reason: "invalid_invoice_id" };
  }
  const crmInvoiceId = rawInvoiceId.trim();
  if (!crmInvoiceId || !isValidUuid(crmInvoiceId)) {
    return { ok: false, reason: "invalid_invoice_id" };
  }

  const rawReference = payload.data?.order;
  if (typeof rawReference !== "string") {
    return { ok: false, reason: "invalid_reference" };
  }
  const providerReference = rawReference.trim();
  if (!providerReference) {
    return { ok: false, reason: "invalid_reference" };
  }

  const rawAmount = payload.data?.total;
  if (typeof rawAmount !== "string") {
    return { ok: false, reason: "invalid_amount" };
  }
  const amountCents = decimalStringToCents(rawAmount);
  if (amountCents === null || amountCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }

  const rawCurrency = payload.data?.currency;
  if (typeof rawCurrency !== "string") {
    return { ok: false, reason: "invalid_currency" };
  }
  const currency = rawCurrency.trim().toUpperCase();
  if (!currency || !CURRENCY_VALUES.includes(currency)) {
    return { ok: false, reason: "invalid_currency" };
  }

  return {
    ok: true,
    event: { eventType: payload.type, crmInvoiceId, providerReference, amountCents, currency },
  };
}
