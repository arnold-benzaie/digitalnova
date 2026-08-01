import "server-only";
import { sendEmail } from "@/lib/email/resend";
import { logAudit } from "@/lib/audit";
import type { Locale } from "@/lib/i18n/dictionaries";

const SIGN_UP_URL = "https://app.public-map.com/sign-up";
const INVITATION_LINK_PAGE_URL = "https://app.public-map.com/invitation-link";

const COPY = {
  fr: {
    subject: (organizationName: string) => `Invitation à rejoindre ${organizationName} sur PUBLIC-MAP`,
    heading: (organizationName: string) => `Vous êtes invité(e) à rejoindre ${organizationName}`,
    body: "Un administrateur vous a invité(e) à accéder à la plateforme PUBLIC-MAP. Créez votre compte avec cette adresse e-mail pour activer votre accès automatiquement — aucun mot de passe ni identifiant ne vous sera transmis, vous créez votre propre accès.",
    cta: "Créer mon compte",
    linkLabel: "Ou copiez ce lien dans votre navigateur :",
    copyLinkCta: "Copier le lien d'inscription",
    important:
      "Important : si vous êtes déjà connecté(e) à PUBLIC-MAP avec un autre compte dans ce navigateur, déconnectez-vous d'abord ou utilisez une fenêtre de navigation privée. Créez le compte avec exactement l'adresse e-mail qui a reçu cette invitation.",
    footer: "Si vous ne vous attendiez pas à cette invitation, vous pouvez ignorer cet e-mail sans risque.",
  },
  en: {
    subject: (organizationName: string) => `Invitation to join ${organizationName} on PUBLIC-MAP`,
    heading: (organizationName: string) => `You're invited to join ${organizationName}`,
    body: "An administrator has invited you to access the PUBLIC-MAP platform. Create your account with this email address to activate your access automatically — no password or credential is shared with you, you create your own access.",
    cta: "Create my account",
    linkLabel: "Or copy this link into your browser:",
    copyLinkCta: "Copy sign-up link",
    important:
      "Important: if you are already signed in to PUBLIC-MAP with another account in this browser, sign out first or use a private/incognito window. Create the account using exactly the email address that received this invitation.",
    footer: "If you weren't expecting this invitation, you can safely ignore this email.",
  },
} as const;

/**
 * The plain-text URL and the secondary "copy link" button are both
 * deliberate fallbacks for the primary button, not decoration: many
 * email clients (Gmail included) block JavaScript entirely, so
 * navigator.clipboard.writeText() cannot run inside the email itself —
 * the secondary button links out to /invitation-link (a real page, see
 * app/invitation-link/page.tsx) where an actual copy button can run.
 * Neither fallback changes SIGN_UP_URL itself or carries any token/email
 * — see this file's own module-level docstring below.
 */
function renderHtml(locale: Locale, organizationName: string): string {
  const t = COPY[locale];
  return `
<div style="background:#fafaf8;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2ddd8;border-radius:16px;padding:32px;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#6b6b6b;">PUBLIC-MAP</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#080808;">${t.heading(organizationName)}</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b6b6b;">${t.body}</p>
    <a href="${SIGN_UP_URL}" style="display:inline-block;padding:12px 24px;background:#080808;color:#fafaf8;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${t.cta}</a>
    <p style="margin:20px 0 4px;font-size:12px;color:#6b6b6b;">${t.linkLabel}</p>
    <p style="margin:0 0 20px;padding:10px 12px;background:#fafaf8;border:1px solid #e2ddd8;border-radius:8px;font-size:13px;color:#080808;word-break:break-all;">${SIGN_UP_URL}</p>
    <a href="${INVITATION_LINK_PAGE_URL}" style="display:inline-block;padding:10px 20px;background:#ffffff;color:#080808;text-decoration:none;border:1px solid #e2ddd8;border-radius:8px;font-size:13px;font-weight:600;">${t.copyLinkCta}</a>
    <p style="margin:28px 0 0;padding:12px 14px;background:#fafaf8;border-radius:8px;font-size:12px;line-height:1.5;color:#080808;">${t.important}</p>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#6b6b6b;">${t.footer}</p>
  </div>
</div>`.trim();
}

/**
 * Best-effort only — the `invitations` row (written by inviteUser()
 * before this is ever called) is the real source of truth; a person can
 * always be told about their invitation out of band and it still
 * activates the moment they sign up with the matching email. A failed or
 * unconfigured send must never fail the invitation itself, so this never
 * throws — same rationale as logAuthFailure() in lib/api-v1/auth.ts.
 * Failures ARE recorded via logAudit (not silently invisible), so "why
 * didn't they get the email" stays diagnosable from the audit log even
 * though the admin-facing action still reports success.
 */
export async function sendInvitationEmail(input: {
  to: string;
  organizationName: string;
  organizationId: string;
  locale: Locale;
}): Promise<{ sent: boolean; id?: string }> {
  const t = COPY[input.locale];
  const result = await sendEmail({
    to: input.to,
    subject: t.subject(input.organizationName),
    html: renderHtml(input.locale, input.organizationName),
  });

  if (!result.sent) {
    await logAudit({
      organizationId: input.organizationId,
      action: "user.invite_email_failed",
      targetType: "invitation",
      metadata: { to: input.to, reason: result.reason },
    }).catch(() => {
      // Auditing a failed send must never itself crash the invite flow.
    });
    return { sent: false };
  }

  return { sent: true, id: result.id };
}
