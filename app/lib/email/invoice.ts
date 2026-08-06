import "server-only";
import { sendEmail } from "@/lib/email/resend";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";

const COPY = {
  fr: {
    subject: (invoiceNumber: string) => `Votre facture PUBLIC-MAP ${invoiceNumber}`,
    heading: "Votre facture est disponible",
    greeting: (clientName: string) => `Bonjour ${clientName},`,
    body: (invoiceNumber: string, amount: string) => `Veuillez trouver ci-joint votre facture ${invoiceNumber} d'un montant de ${amount}.`,
    dueLabel: "Date d'échéance :",
    linkLabel: "Vous pouvez consulter ou télécharger votre facture à partir du lien sécurisé ci-dessous.",
    cta: "Consulter la facture",
    signoff: "Cordialement,",
    footer: "PUBLIC-MAP",
  },
  en: {
    subject: (invoiceNumber: string) => `Your PUBLIC-MAP invoice ${invoiceNumber}`,
    heading: "Your invoice is available",
    greeting: (clientName: string) => `Hello ${clientName},`,
    body: (invoiceNumber: string, amount: string) => `Please find your invoice ${invoiceNumber} for ${amount}.`,
    dueLabel: "Due date:",
    linkLabel: "You can securely view or download your invoice using the link below.",
    cta: "View invoice",
    signoff: "Kind regards,",
    footer: "PUBLIC-MAP",
  },
} as const;

/**
 * Same rendering shape as lib/email/invitation.ts's renderHtml — plain
 * inline-styled HTML, no template engine, matching the one established
 * transactional-email look in this app.
 */
function renderHtml(locale: Locale, params: { clientName: string; invoiceNumber: string; amount: string; dueDate: string | null; accessUrl: string }): string {
  const t = COPY[locale];
  return `
<div style="background:#fafaf8;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2ddd8;border-radius:16px;padding:32px;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#6b6b6b;">PUBLIC-MAP</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#080808;">${t.heading}</h1>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#080808;">${t.greeting(escapeHtml(params.clientName))}</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#6b6b6b;">${t.body(escapeHtml(params.invoiceNumber), escapeHtml(params.amount))}</p>
    ${params.dueDate ? `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b6b6b;">${t.dueLabel} ${escapeHtml(params.dueDate)}</p>` : ""}
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b6b6b;">${t.linkLabel}</p>
    <a href="${params.accessUrl}" style="display:inline-block;padding:12px 24px;background:#080808;color:#fafaf8;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${t.cta}</a>
    <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#080808;">${t.signoff}<br/>${t.footer}</p>
  </div>
</div>`.trim();
}

/** Minimal escaping for values interpolated into this hand-built HTML
 * string — client name/invoice number are user-entered data, never
 * trusted verbatim inside markup, same discipline React JSX gives for
 * free elsewhere in this app. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Best-effort — mirrors sendInvitationEmail()'s contract exactly: never
 * throws (a failed/unconfigured send must never crash the triggering
 * Server Action), returns a plain result the caller acts on. Unlike the
 * invitation email, invoice delivery success/failure IS the caller's
 * business state (crmInvoices.status/emailDeliveryStatus) — so this
 * returns the full SendEmailResult shape rather than collapsing it to a
 * boolean, and does NOT itself write any audit/DB row: that's
 * deliverInvoiceEmail()'s job in lib/actions/crm-invoices.ts, the single
 * place that owns the invoice's delivery state.
 */
export async function sendInvoiceEmail(input: {
  to: string;
  locale: Locale;
  clientName: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  dueAt: Date | null;
  accessUrl: string;
  attachment?: { filename: string; content: Buffer };
  idempotencyKey?: string;
}) {
  const t = COPY[input.locale];
  const amount = formatCurrency(input.amountCents / 100, input.currency, input.locale);
  const dueDate = input.dueAt ? formatDate(input.dueAt, input.locale) : null;

  return sendEmail({
    to: input.to,
    subject: t.subject(input.invoiceNumber),
    html: renderHtml(input.locale, { clientName: input.clientName, invoiceNumber: input.invoiceNumber, amount, dueDate, accessUrl: input.accessUrl }),
    attachments: input.attachment ? [{ filename: input.attachment.filename, content: input.attachment.content, contentType: "application/pdf" }] : undefined,
    idempotencyKey: input.idempotencyKey,
  });
}
