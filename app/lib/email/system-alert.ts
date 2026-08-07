import "server-only";
import { sendEmail } from "@/lib/email/resend";

const COPY = {
  fr: {
    alertSubject: "[PUBLIC-MAP] Alerte base de données",
    recoveredSubject: "[PUBLIC-MAP] Base de données rétablie",
    alertHeading: "Incident détecté",
    recoveredHeading: "Service rétabli",
    dateLabel: "Date :",
    envLabel: "Environnement :",
    serviceLabel: "Service :",
    errorTypeLabel: "Type d'erreur :",
    latencyLabel: "Latence :",
    consecutiveLabel: "Échecs consécutifs :",
    recommendation: "Recommandation : vérifier /admin/system-health. Si EMAXCONNSESSION persiste, envisager le chantier Transaction Pooler (voir le diagnostic du 2026-08-07).",
    recoveredBody: "Le service a répondu normalement lors de la dernière vérification.",
    signoff: "PUBLIC-MAP — surveillance automatique",
  },
  en: {
    alertSubject: "[PUBLIC-MAP] Database alert",
    recoveredSubject: "[PUBLIC-MAP] Database recovered",
    alertHeading: "Incident detected",
    recoveredHeading: "Service recovered",
    dateLabel: "Date:",
    envLabel: "Environment:",
    serviceLabel: "Service:",
    errorTypeLabel: "Error type:",
    latencyLabel: "Latency:",
    consecutiveLabel: "Consecutive failures:",
    recommendation: "Recommendation: check /admin/system-health. If EMAXCONNSESSION persists, consider the Transaction Pooler workstream (see the 2026-08-07 diagnostic).",
    recoveredBody: "The service responded normally on the latest check.",
    signoff: "PUBLIC-MAP — automated monitoring",
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function row(label: string, value: string): string {
  return `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#080808;"><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</p>`;
}

/**
 * Never throws — mirrors every other transactional email in this app
 * (sendInvoiceEmail, sendInvitationEmail): degrades to {sent:false} when
 * RESEND_API_KEY or the recipient list isn't configured, so a monitoring
 * failure can never crash the health-check route itself.
 */
export async function sendSystemAlertEmail(input: {
  to: string[];
  locale: "fr" | "en";
  kind: "alert" | "recovered";
  service: string;
  errorCategory?: string | null;
  errorCode?: string | null;
  latencyMs?: number | null;
  consecutiveFailures?: number;
  environment: string;
}) {
  if (input.to.length === 0) return { sent: false as const, reason: "No alert recipient configured (SYSTEM_ALERT_EMAIL)." };

  const t = COPY[input.locale];
  const isRecovered = input.kind === "recovered";
  const subject = isRecovered ? t.recoveredSubject : t.alertSubject;
  const heading = isRecovered ? t.recoveredHeading : t.alertHeading;
  const timestamp = new Date().toISOString();

  const details = isRecovered
    ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#6b6b6b;">${escapeHtml(t.recoveredBody)}</p>`
    : [
        row(t.errorTypeLabel, input.errorCategory ?? input.errorCode ?? "unknown"),
        typeof input.latencyMs === "number" ? row(t.latencyLabel, `${input.latencyMs}ms`) : "",
        typeof input.consecutiveFailures === "number" ? row(t.consecutiveLabel, String(input.consecutiveFailures)) : "",
      ].join("");

  const html = `
<div style="background:#fafaf8;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2ddd8;border-radius:16px;padding:32px;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:${isRecovered ? "#1a7f37" : "#b42318"};">PUBLIC-MAP</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#080808;">${escapeHtml(heading)}</h1>
    ${row(t.dateLabel, timestamp)}
    ${row(t.envLabel, input.environment)}
    ${row(t.serviceLabel, input.service)}
    ${details}
    ${!isRecovered ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b6b6b;">${escapeHtml(t.recommendation)}</p>` : ""}
    <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#8a8a8a;">${escapeHtml(t.signoff)}</p>
  </div>
</div>`.trim();

  const results = await Promise.all(input.to.map((to) => sendEmail({ to, subject, html })));
  const anySent = results.some((r) => r.sent);
  return anySent ? ({ sent: true as const } as const) : ({ sent: false as const, reason: "All recipient sends failed or Resend is unconfigured." } as const);
}
