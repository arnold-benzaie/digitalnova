import "server-only";
import { sendEmail } from "@/lib/email/resend";

/**
 * Commercial chat notification email (new lead / advisor request) — a
 * sibling to lib/email/system-alert.ts, not a modification of it: that
 * file is DB-health-specific (copy, recipients, cooldown all tied to
 * `service: "database"`) and already in production use, so this stays a
 * separate, small function rather than risking it. Both share the same
 * two real primitives: the single Resend wrapper (sendEmail) and the
 * same escapeHtml/row visual pattern — nothing about sending email is
 * duplicated, only the copy and recipient env var differ.
 *
 * Recipients come from CHAT_NOTIFICATION_EMAIL (comma-separated),
 * deliberately separate from SYSTEM_ALERT_EMAIL — different audience
 * (commercial/lead follow-up vs technical ops). Never throws; degrades
 * to {sent:false} exactly like every other transactional email in this
 * app when unconfigured.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function row(label: string, value: string): string {
  return `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#080808;"><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</p>`;
}

function recipients(): string[] {
  const raw = process.env.CHAT_NOTIFICATION_EMAIL;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const COPY = {
  fr: {
    leadSubject: "[PUBLIC-MAP] Nouveau lead — assistant IA",
    humanSubject: "[PUBLIC-MAP] Demande de conseiller — assistant IA",
    leadHeading: "Nouveau lead capturé",
    humanHeading: "Demande d'assistance humaine",
    nameLabel: "Nom :",
    emailLabel: "E-mail :",
    phoneLabel: "Téléphone :",
    orgLabel: "Organisation :",
    surfaceLabel: "Surface :",
    languageLabel: "Langue :",
    summaryLabel: "Besoin (résumé) :",
    dateLabel: "Date :",
    conversationLabel: "Conversation :",
    viewClient: "Voir la fiche client",
  },
  en: {
    leadSubject: "[PUBLIC-MAP] New lead — AI assistant",
    humanSubject: "[PUBLIC-MAP] Advisor requested — AI assistant",
    leadHeading: "New lead captured",
    humanHeading: "Human support requested",
    nameLabel: "Name:",
    emailLabel: "Email:",
    phoneLabel: "Phone:",
    orgLabel: "Organization:",
    surfaceLabel: "Surface:",
    languageLabel: "Language:",
    summaryLabel: "Need (summary):",
    dateLabel: "Date:",
    conversationLabel: "Conversation:",
    viewClient: "View client record",
  },
} as const;

export type ChatNotificationEmailInput = {
  kind: "lead_captured" | "human_requested";
  conversationId: string;
  surface: "app" | "site" | undefined;
  locale: "fr" | "en";
  fullName?: string;
  email?: string;
  phone?: string;
  organizationName?: string | null;
  /** Short, non-sensitive summary — never the raw conversation transcript
   * (§7: "ne mets pas nécessairement l'intégralité de la conversation"). */
  summary?: string;
  /** Set only when a real, safe route exists (the lead was linked to a
   * CRM client) — never a fabricated link. */
  crmClientId?: string | null;
};

export async function sendChatNotificationEmail(input: ChatNotificationEmailInput) {
  const to = recipients();
  if (to.length === 0) return { sent: false as const, reason: "No recipient configured (CHAT_NOTIFICATION_EMAIL)." };

  // The email itself is always in French — it's read by PUBLIC-MAP staff,
  // not the prospect, same precedent as sendSystemAlertEmail's hardcoded
  // locale:"fr". `input.locale` (the prospect's own conversation
  // language) is still shown as an informational row in the body below.
  const t = COPY.fr;
  const isLead = input.kind === "lead_captured";
  const subject = isLead ? t.leadSubject : t.humanSubject;
  const heading = isLead ? t.leadHeading : t.humanHeading;
  const timestamp = new Date().toISOString();

  const details = [
    input.fullName ? row(t.nameLabel, input.fullName) : "",
    input.email ? row(t.emailLabel, input.email) : "",
    input.phone ? row(t.phoneLabel, input.phone) : "",
    input.organizationName ? row(t.orgLabel, input.organizationName) : "",
    row(t.surfaceLabel, input.surface ?? "app"),
    row(t.languageLabel, input.locale),
    input.summary ? row(t.summaryLabel, input.summary) : "",
    row(t.dateLabel, timestamp),
    row(t.conversationLabel, input.conversationId),
  ].join("");

  // /admin/crm/clients/[id] already exists and is staff-only — a safe,
  // real link, only ever included when a lead is actually linked. No
  // fabricated route otherwise (§7).
  const clientLink = input.crmClientId
    ? `<p style="margin:16px 0 0;"><a href="https://app.public-map.com/admin/crm/clients/${encodeURIComponent(input.crmClientId)}" style="font-size:14px;color:#1a5fb4;">${escapeHtml(t.viewClient)}</a></p>`
    : "";

  const html = `
<div style="background:#fafaf8;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2ddd8;border-radius:16px;padding:32px;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#1a5fb4;">PUBLIC-MAP</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#080808;">${escapeHtml(heading)}</h1>
    ${details}
    ${clientLink}
  </div>
</div>`.trim();

  const results = await Promise.all(to.map((recipient) => sendEmail({ to: recipient, subject, html })));
  const anySent = results.some((r) => r.sent);
  return anySent ? ({ sent: true as const } as const) : ({ sent: false as const, reason: "All recipient sends failed or Resend is unconfigured." } as const);
}
