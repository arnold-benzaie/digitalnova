import "server-only";
import { sendEmail } from "@/lib/email/resend";

/**
 * Technical "the AI assistant is failing repeatedly" alert — a sibling
 * to lib/email/system-alert.ts (same visual pattern, same
 * escapeHtml/row helpers, same "never throws" contract), not a
 * modification of it: that file's copy/recipients/cooldown are
 * DB-health-specific and already in production use for
 * /api/cron/db-health. Reuses SYSTEM_ALERT_EMAIL as-is (same technical-
 * ops audience as a DB outage — no new variable needed for this part).
 *
 * Content is deliberately generic (§10): environment, error category,
 * occurrence count, window, route — never a raw stack trace, never a
 * prompt, never DEEPSEEK_API_KEY, never user-authored message content.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function row(label: string, value: string): string {
  return `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#080808;"><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</p>`;
}

function alertRecipients(): string[] {
  const raw = process.env.SYSTEM_ALERT_EMAIL;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendChatAlertEmail(input: { environment: string; errorCategory: string; occurrences: number; windowMinutes: number; route: string }) {
  const to = alertRecipients();
  if (to.length === 0) return { sent: false as const, reason: "No alert recipient configured (SYSTEM_ALERT_EMAIL)." };

  const subject = "PUBLIC-MAP Assistant — erreurs IA répétées détectées";
  const timestamp = new Date().toISOString();

  const html = `
<div style="background:#fafaf8;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2ddd8;border-radius:16px;padding:32px;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#b42318;">PUBLIC-MAP</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#080808;">Incident IA détecté</h1>
    ${row("Date :", timestamp)}
    ${row("Environnement :", input.environment)}
    ${row("Route :", input.route)}
    ${row("Type d'erreur :", input.errorCategory)}
    ${row("Occurrences :", `${input.occurrences} sur les ${input.windowMinutes} dernières minutes`)}
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b6b6b;">Recommandation : vérifier /admin/system-health et les Runtime Logs Vercel du projet "app". Vous ne recevrez pas d'autre alerte pour ce type d'erreur avant la fin du cooldown.</p>
    <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#8a8a8a;">PUBLIC-MAP — surveillance automatique</p>
  </div>
</div>`.trim();

  const results = await Promise.all(to.map((recipient) => sendEmail({ to: recipient, subject, html })));
  const anySent = results.some((r) => r.sent);
  return anySent ? ({ sent: true as const } as const) : ({ sent: false as const, reason: "All recipient sends failed or Resend is unconfigured." } as const);
}
