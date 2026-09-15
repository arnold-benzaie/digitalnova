import "server-only";
import { sendEmail } from "@/lib/email/resend";
import { logAudit } from "@/lib/audit";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { ListedWorkforceRole } from "@/lib/actions/workforce";

const ACCEPT_INVITATION_URL = "https://app.public-map.com/accept-invitation";
const SIGN_UP_URL = "https://app.public-map.com/sign-up";
const INVITATION_LINK_PAGE_URL = "https://app.public-map.com/invitation-link";

/**
 * WORKFORCE INVITATION V1 — Axis-C counterpart of lib/email/invitation.ts,
 * same infrastructure (Resend via lib/email/resend.ts, the same generic
 * /accept-invitation + /invitation-link pages, the same best-effort/never-
 * throws contract), different copy: this invites someone to the INTERNAL
 * team with a specific Workforce role, never an organization/client
 * membership. Deliberately its own file (not a parameter added to
 * sendInvitationEmail()) so the Axis-A template — and its callers in
 * lib/actions/users.ts — are completely untouched by this Workforce-only
 * addition.
 */
function acceptInvitationUrl(clerkTicket?: string): string {
  return clerkTicket ? `${ACCEPT_INVITATION_URL}?__clerk_ticket=${encodeURIComponent(clerkTicket)}` : ACCEPT_INVITATION_URL;
}

const ROLE_LABEL: Record<ListedWorkforceRole, { fr: string; en: string }> = {
  ADMIN: { fr: "Administrateur", en: "Administrator" },
  MANAGER: { fr: "Manager", en: "Manager" },
  EMPLOYEE: { fr: "Employé", en: "Employee" },
};

const COPY = {
  fr: {
    subject: "Invitation à rejoindre l'équipe PUBLIC-MAP",
    heading: "Vous êtes invité(e) à rejoindre l'équipe interne PUBLIC-MAP",
    body: (roleLabel: string) =>
      `Un administrateur vous a invité(e) à rejoindre l'équipe interne PUBLIC-MAP avec le rôle « ${roleLabel} ». Créez votre compte avec cette adresse e-mail pour activer votre accès automatiquement — aucun mot de passe ni identifiant ne vous sera transmis, vous créez votre propre accès.`,
    cta: "Créer mon compte",
    linkLabel: "Ou copiez ce lien dans votre navigateur :",
    copyLinkCta: "Copier le lien d'inscription",
    important:
      "Important : votre accès ne sera actif qu'une fois votre compte créé avec exactement l'adresse e-mail qui a reçu cette invitation. Si vous êtes déjà connecté(e) à PUBLIC-MAP avec un autre compte dans ce navigateur, déconnectez-vous d'abord ou utilisez une fenêtre de navigation privée.",
    footer: "Si vous ne vous attendiez pas à cette invitation, vous pouvez ignorer cet e-mail sans risque.",
  },
  en: {
    subject: "Invitation to join the PUBLIC-MAP team",
    heading: "You're invited to join the PUBLIC-MAP internal team",
    body: (roleLabel: string) =>
      `An administrator has invited you to join the PUBLIC-MAP internal team with the role "${roleLabel}". Create your account with this email address to activate your access automatically — no password or credential is shared with you, you create your own access.`,
    cta: "Create my account",
    linkLabel: "Or copy this link into your browser:",
    copyLinkCta: "Copy sign-up link",
    important:
      "Important: your access only activates once your account is created with exactly the email address that received this invitation. If you are already signed in to PUBLIC-MAP with another account in this browser, sign out first or use a private/incognito window.",
    footer: "If you weren't expecting this invitation, you can safely ignore this email.",
  },
} as const;

function renderHtml(locale: Locale, role: ListedWorkforceRole, clerkTicket?: string): string {
  const t = COPY[locale];
  const roleLabel = ROLE_LABEL[role][locale];
  return `
<div style="background:#fafaf8;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2ddd8;border-radius:16px;padding:32px;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#6b6b6b;">PUBLIC-MAP</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#080808;">${t.heading}</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b6b6b;">${t.body(roleLabel)}</p>
    <a href="${acceptInvitationUrl(clerkTicket)}" style="display:inline-block;padding:12px 24px;background:#080808;color:#fafaf8;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${t.cta}</a>
    <p style="margin:20px 0 4px;font-size:12px;color:#6b6b6b;">${t.linkLabel}</p>
    <p style="margin:0 0 20px;padding:10px 12px;background:#fafaf8;border:1px solid #e2ddd8;border-radius:8px;font-size:13px;color:#080808;word-break:break-all;">${SIGN_UP_URL}</p>
    <a href="${INVITATION_LINK_PAGE_URL}" style="display:inline-block;padding:10px 20px;background:#ffffff;color:#080808;text-decoration:none;border:1px solid #e2ddd8;border-radius:8px;font-size:13px;font-weight:600;">${t.copyLinkCta}</a>
    <p style="margin:28px 0 0;padding:12px 14px;background:#fafaf8;border-radius:8px;font-size:12px;line-height:1.5;color:#080808;">${t.important}</p>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#6b6b6b;">${t.footer}</p>
  </div>
</div>`.trim();
}

/**
 * Best-effort only, same rationale as sendInvitationEmail() (lib/email/
 * invitation.ts): the `staff_invitations` row (written by
 * inviteWorkforceMember() before this is ever called) is the real source
 * of truth. Never throws. Failures are recorded via logAudit so "why
 * didn't they get the email" stays diagnosable even though the caller
 * still reports success. Never logs a token — this template embeds no
 * token of its own (only an optional best-effort Clerk ticket, which is
 * not logged either).
 */
export async function sendWorkforceInvitationEmail(input: {
  to: string;
  role: ListedWorkforceRole;
  organizationId: string;
  locale: Locale;
  clerkTicket?: string;
}): Promise<{ sent: boolean; id?: string }> {
  const t = COPY[input.locale];
  const result = await sendEmail({
    to: input.to,
    subject: t.subject,
    html: renderHtml(input.locale, input.role, input.clerkTicket),
  });

  if (!result.sent) {
    await logAudit({
      organizationId: input.organizationId,
      action: "workforce.invite_email_failed",
      targetType: "staff_invitation",
      metadata: { to: input.to, reason: result.reason },
    }).catch(() => {
      // Auditing a failed send must never itself crash the invite flow.
    });
    return { sent: false };
  }

  return { sent: true, id: result.id };
}
