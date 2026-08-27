import "server-only";
import { sendEmail } from "@/lib/email/resend";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";

const COPY = {
  fr: {
    subject: (quoteNumber: string) => `Votre devis PUBLIC-MAP ${quoteNumber}`,
    heading: "Votre devis est disponible",
    greeting: (clientName: string) => `Bonjour ${clientName},`,
    body: (quoteNumber: string, amount: string) => `Veuillez trouver ci-dessous votre devis ${quoteNumber} d'un montant de ${amount}.`,
    validUntilLabel: "Valable jusqu'au :",
    linkLabel: "Vous pouvez consulter votre devis à partir du lien sécurisé ci-dessous.",
    cta: "Voir mon devis",
    signoff: "Cordialement,",
    footer: "PUBLIC-MAP",
  },
  en: {
    subject: (quoteNumber: string) => `Your PUBLIC-MAP quote ${quoteNumber}`,
    heading: "Your quote is available",
    greeting: (clientName: string) => `Hello ${clientName},`,
    body: (quoteNumber: string, amount: string) => `Please find your quote ${quoteNumber} for ${amount} below.`,
    validUntilLabel: "Valid until:",
    linkLabel: "You can securely view your quote using the link below.",
    cta: "View my quote",
    signoff: "Kind regards,",
    footer: "PUBLIC-MAP",
  },
} as const;

/**
 * Same rendering shape as lib/email/invoice.ts's renderHtml — plain
 * inline-styled HTML, no template engine, matching the one established
 * transactional-email look in this app. No PDF attachment (Phase 3 sends a
 * link to the public quote-verification page only, never a document
 * download by email — out of this phase's minimal scope).
 */
function renderHtml(locale: Locale, params: { clientName: string; quoteNumber: string; amount: string; validUntil: string | null; accessUrl: string }): string {
  const t = COPY[locale];
  return `
<div style="background:#fafaf8;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2ddd8;border-radius:16px;padding:32px;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#6b6b6b;">PUBLIC-MAP</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#080808;">${t.heading}</h1>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#080808;">${t.greeting(escapeHtml(params.clientName))}</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#6b6b6b;">${t.body(escapeHtml(params.quoteNumber), escapeHtml(params.amount))}</p>
    ${params.validUntil ? `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b6b6b;">${t.validUntilLabel} ${escapeHtml(params.validUntil)}</p>` : ""}
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b6b6b;">${t.linkLabel}</p>
    <a href="${params.accessUrl}" style="display:inline-block;padding:12px 24px;background:#080808;color:#fafaf8;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${t.cta}</a>
    <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#080808;">${t.signoff}<br/>${t.footer}</p>
  </div>
</div>`.trim();
}

/** Minimal escaping for values interpolated into this hand-built HTML
 * string — client name/quote number are user-entered data, never trusted
 * verbatim inside markup, same discipline React JSX gives for free
 * elsewhere in this app. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Best-effort — mirrors sendInvoiceEmail()'s contract exactly: never
 * throws (a failed/unconfigured send must never crash the triggering
 * Server Action), returns a plain result the caller acts on. Delivery
 * success/failure IS the caller's business state (crmQuotes.status/sentAt,
 * see lib/actions/crm-quotes.ts) — this function does not itself write
 * any DB row.
 */
export async function sendQuoteEmail(input: {
  to: string;
  locale: Locale;
  clientName: string;
  quoteNumber: string;
  totalCents: number;
  currency: string;
  validUntil: Date | null;
  accessUrl: string;
  idempotencyKey?: string;
}) {
  const t = COPY[input.locale];
  const amount = formatCurrency(input.totalCents / 100, input.currency, input.locale);
  const validUntil = input.validUntil ? formatDate(input.validUntil, input.locale) : null;

  return sendEmail({
    to: input.to,
    subject: t.subject(input.quoteNumber),
    html: renderHtml(input.locale, { clientName: input.clientName, quoteNumber: input.quoteNumber, amount, validUntil, accessUrl: input.accessUrl }),
    idempotencyKey: input.idempotencyKey,
  });
}
