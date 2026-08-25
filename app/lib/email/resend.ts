import "server-only";
import { Resend } from "resend";

/**
 * Thin Resend wrapper — the only place in the app that talks to the
 * email provider. Mirrors the existing "always usable, degrades cleanly
 * until real credentials exist" convention (lib/esign, lib/billing's mock
 * provider): with no RESEND_API_KEY, sendEmail() returns a clear
 * `sent: false` instead of throwing, so callers can decide for themselves
 * whether an unsent email should block anything (for invitations it
 * never does — see lib/email/invitation.ts).
 */
let cachedClient: Resend | null = null;

function resendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Resend(apiKey);
  return cachedClient;
}

export type SendEmailResult = { sent: true; id: string } | { sent: false; reason: string };

export type EmailAttachment = { filename: string; content: Buffer; contentType?: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  /** Forwarded to Resend as-is when set — lets a caller (e.g. invoice
   * delivery) make a retried send safe against actually double-sending at
   * the provider level, on top of whatever DB-level guard it already has.
   * Optional and additive: every existing caller omits it and behaves
   * exactly as before. */
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  const client = resendClient();
  if (!client) {
    // This whole function previously returned every outcome silently (by
    // design, so a broken email channel never blocks the caller) with no
    // logging anywhere, making a real Resend-level rejection
    // indistinguishable from a genuine success in the logs — found while
    // diagnosing a report of chat-notification emails never arriving.
    // Logging only the failure path keeps this low-volume and never
    // includes the API key, the html body, or anything beyond the single
    // recipient address already being processed.
    console.error("[email] sendEmail: RESEND_API_KEY is not configured — send not attempted.");
    return { sent: false, reason: "RESEND_API_KEY is not configured." };
  }

  // Must be an address on the domain actually verified in Resend
  // (mail.public-map.com) — sending "from" an unverified domain is
  // rejected by Resend regardless of API key validity.
  const from = process.env.RESEND_FROM_EMAIL || "PUBLIC-MAP <invitations@mail.public-map.com>";
  const { data, error } = await client.emails.send(
    {
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    },
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
  );
  if (error) {
    console.error(`[email] sendEmail: Resend rejected the send — from=${from} to=${input.to} name=${error.name} message=${error.message}`);
    return { sent: false, reason: error.message };
  }
  // A response with neither `error` nor a real `data.id` is not a
  // confirmed send — never infer success from the mere absence of an
  // error field.
  if (!data?.id) {
    console.error(`[email] sendEmail: Resend returned no email id (ambiguous non-error response) — from=${from} to=${input.to}`);
    return { sent: false, reason: "Resend returned no email id." };
  }
  return { sent: true, id: data.id };
}
