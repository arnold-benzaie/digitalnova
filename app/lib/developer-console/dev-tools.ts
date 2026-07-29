"use server";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { generateWebhookSecret, signWebhookBody } from "@/lib/integrations/crypto";
import { serializeIntegrationEvent, userPendingCreatedEnvelope } from "@/lib/integrations/contracts";
import { UnsafeWebhookUrlError, validateWebhookUrl } from "@/lib/integrations/url-security";
import { parseApiKey } from "@/lib/api-v1/auth";
import { logAudit } from "@/lib/audit";

/**
 * Stage 4 (developer environment) server actions — Playground / Webhook
 * test tool / signature verifier / API key format inspector.
 *
 * Deliberately EPHEMERAL: none of this persists a `webhookEndpoints` row
 * or reuses lib/integrations/test-runner.ts (whose previewTestEvent/
 * sendTestDelivery hard-require one via loadEndpointAndSecret — see that
 * file). What IS reused, never re-implemented: the real signing
 * (signWebhookBody), the real SSRF guard (validateWebhookUrl), and the
 * real event envelope shape (userPendingCreatedEnvelope +
 * serializeIntegrationEvent) — so a developer testing here sees the exact
 * headers/signature format a real delivery would send. Full persistent
 * webhook endpoint management (subscriptions, retries, delivery history)
 * stays out of scope for this stage — see the Stage 4 report.
 */

const MESSAGES = {
  fr: {
    // validateWebhookUrl (lib/integrations/url-security.ts) throws the
    // SAME UnsafeWebhookUrlError for a malformed string as for a
    // syntactically valid but unsafe destination — deliberately, so a
    // caller can't use error text to probe which reason applied. One
    // message covers both here for the same reason.
    unsafeUrl: "URL invalide ou non autorisée (doit être une destination HTTPS publique — pas locale, interne ou privée).",
    secretRequired: "Le secret est requis.",
    bodyRequired: "Le corps de la requête est requis.",
    signatureRequired: "La signature reçue est requise.",
    timestampRequired: "L'horodatage est requis.",
  },
  en: {
    unsafeUrl: "Invalid or disallowed URL (must be a public HTTPS destination — not local, internal, or private).",
    secretRequired: "The secret is required.",
    bodyRequired: "The request body is required.",
    signatureRequired: "The received signature is required.",
    timestampRequired: "The timestamp is required.",
  },
} as const;

export type WebhookTestResult = {
  requestId: string;
  secretUsed: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  responseStatus: number | null;
  responseBody: string | null;
  durationMs: number;
  errorCode: "timeout" | "network_error" | null;
};

/** Signs and POSTs a synthetic event to a developer-supplied URL, using
 * the real header/signature format — without ever creating a persisted
 * webhook endpoint. `redirect: "manual"` so a redirect is reported back
 * as-is (a 3xx status), never silently followed to a second, unvalidated
 * destination. */
export async function sendAdhocWebhookTest(formData: FormData): Promise<WebhookTestResult> {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);

  const rawUrl = String(formData.get("url") ?? "").trim();
  const providedSecret = String(formData.get("secret") ?? "").trim();
  const secret = providedSecret || generateWebhookSecret();

  let validatedUrl: URL;
  try {
    validatedUrl = await validateWebhookUrl(rawUrl);
  } catch (error) {
    if (!(error instanceof UnsafeWebhookUrlError)) throw error;
    throw new Error(MESSAGES[locale].unsafeUrl);
  }

  const eventId = randomUUID();
  const envelope = userPendingCreatedEnvelope({
    id: eventId,
    occurredAt: new Date(),
    userId: "console-webhook-test",
    displayName: `Test — ${session.organizationName}`,
  });
  const rawBody = serializeIntegrationEvent(envelope);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookBody(secret, timestamp, rawBody);

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Public-Map-Event-Id": envelope.id,
    "X-Public-Map-Event-Type": envelope.type,
    "X-Public-Map-Timestamp": timestamp,
    "X-Public-Map-Signature": signature,
    "X-Public-Map-Test": "true",
  };

  const startedAt = Date.now();
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let errorCode: WebhookTestResult["errorCode"] = null;

  try {
    const response = await fetch(validatedUrl, {
      method: "POST",
      redirect: "manual",
      headers: requestHeaders,
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = response.status;
    responseBody = (await response.text().catch(() => "")).slice(0, 4000);
  } catch (error) {
    errorCode = error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network_error";
  }
  const durationMs = Date.now() - startedAt;

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "webhook_test.sent",
    targetType: "webhook_test",
    targetId: eventId,
    metadata: { urlOrigin: validatedUrl.origin, urlPath: validatedUrl.pathname, responseStatus, errorCode, durationMs },
  });

  return { requestId: eventId, secretUsed: secret, requestHeaders, requestBody: rawBody, responseStatus, responseBody, durationMs, errorCode };
}

export type SignatureVerificationResult = { valid: boolean; expectedSignature: string };

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Recomputes the expected HMAC-SHA256 signature with the SAME algorithm
 * real deliveries use (signWebhookBody) and compares it to what the
 * developer received, in constant time — mirrors the check their own
 * webhook handler should perform. */
export async function verifyWebhookSignatureAction(formData: FormData): Promise<SignatureVerificationResult> {
  const [, locale] = await Promise.all([requireSession(), getLocale()]);

  const secret = String(formData.get("secret") ?? "").trim();
  const timestamp = String(formData.get("timestamp") ?? "").trim();
  const rawBody = String(formData.get("body") ?? "");
  const providedSignature = String(formData.get("signature") ?? "").trim();

  if (!secret) throw new Error(MESSAGES[locale].secretRequired);
  if (!timestamp) throw new Error(MESSAGES[locale].timestampRequired);
  if (!providedSignature) throw new Error(MESSAGES[locale].signatureRequired);

  const expectedSignature = signWebhookBody(secret, timestamp, rawBody);
  return { valid: timingSafeEqualStrings(expectedSignature, providedSignature), expectedSignature };
}

export type ApiKeyInspection =
  | { valid: true; environment: "live" | "test"; keyPrefix: string; lookupId: string }
  | { valid: false };

/** Thin server-action wrapper around lib/api-v1/auth.ts's parseApiKey —
 * that file carries `import "server-only"`, so a client component can
 * never call it directly, and its regex/slicing logic must never be
 * duplicated here (see that file's own docstring on why `.split("_")`
 * would be wrong). Format-only: never looks the key up in the database,
 * never reveals whether it is active/revoked/real. */
export async function inspectApiKeyFormatAction(formData: FormData): Promise<ApiKeyInspection> {
  await requireSession();
  const rawKey = String(formData.get("key") ?? "").trim();
  const parsed = parseApiKey(rawKey);
  if (!parsed) return { valid: false };
  return { valid: true, environment: parsed.environment, keyPrefix: parsed.keyPrefix, lookupId: parsed.lookupId };
}
