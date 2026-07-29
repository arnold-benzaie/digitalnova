"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { integrationTestRuns } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import { getWebhookEndpointForOrg } from "@/lib/developer-console/queries";
import { previewTestEvent, replayTestRun, sendTestDelivery } from "@/lib/integrations/test-runner";

/**
 * Self-service Playground actions for the Developer Console
 * (/developers/console/tests) — the org-member-facing counterpart to
 * lib/actions/integrations-tests.ts (staff-only, requireAdminRole(), any
 * organization). Same relationship as lib/developer-console/webhooks-actions.ts
 * is to lib/actions/integrations-webhooks.ts: a SEPARATE module
 * (requireSession() + an explicit per-call ownership check, never
 * requireAdminRole()), reusing lib/integrations/test-runner.ts's real
 * business logic as-is.
 *
 * Deliberately does NOT port triggerWorkerNowAction — that action runs
 * the platform-wide outbox worker across every organization's pending
 * deliveries, not just the caller's own (see its own doc comment in
 * lib/actions/integrations-tests.ts). Exposing a global side-effect like
 * that to a self-service org member is out of scope; self-service test
 * deliveries are picked up by the normal automatic worker cadence.
 *
 * Audit trail uses its own "developer_test.*" namespace — distinct from
 * the admin path's "integration_test.*" — same reasoning as apikey.* vs
 * integration_api_key.* and webhook.* vs webhook_endpoint.* elsewhere in
 * this module.
 */

const MESSAGES = {
  fr: {
    endpointNotFound: "Endpoint introuvable.",
    testRunNotFound: "Test introuvable.",
    encryptionNotConfigured:
      "Le chiffrement des intégrations n'est pas configuré sur cet environnement (INTEGRATION_SECRET_ENCRYPTION_KEY manquant).",
  },
  en: {
    endpointNotFound: "Endpoint not found.",
    testRunNotFound: "Test run not found.",
    encryptionNotConfigured: "Integration encryption is not configured on this environment (missing INTEGRATION_SECRET_ENCRYPTION_KEY).",
  },
} as const;

function ensureEncryptionConfigured(locale: Locale) {
  if (!process.env.INTEGRATION_SECRET_ENCRYPTION_KEY) {
    throw new Error(MESSAGES[locale].encryptionNotConfigured);
  }
}

async function loadOwnedEndpoint(organizationId: string, endpointId: string, locale: Locale) {
  const endpoint = await getWebhookEndpointForOrg(organizationId, endpointId);
  if (!endpoint) throw new Error(MESSAGES[locale].endpointNotFound);
  return endpoint;
}

export type SerializedDeveloperTestRun = {
  id: string;
  endpointId: string | null;
  mode: string;
  eventType: string;
  eventVersion: number;
  requestPayload: unknown;
  requestSignature: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  responseDurationMs: number | null;
  errorCode: string | null;
  replayOfId: string | null;
  createdAt: string;
};

function serializeRun(run: typeof integrationTestRuns.$inferSelect): SerializedDeveloperTestRun {
  return { ...run, createdAt: run.createdAt.toISOString() };
}

export async function previewDeveloperTestEvent(endpointId: string) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  ensureEncryptionConfigured(locale);
  const endpoint = await loadOwnedEndpoint(session.organizationId, endpointId, locale);

  const result = await previewTestEvent({
    organizationId: session.organizationId,
    integrationId: endpoint.integrationId,
    endpointId: endpoint.id,
    triggeredByUserId: session.userId,
  });

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "developer_test.previewed",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name, eventType: result.run.eventType },
  });

  revalidatePath("/developers/console/tests");
  return { run: serializeRun(result.run), headers: result.headers };
}

export async function sendDeveloperTestDelivery(endpointId: string) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  ensureEncryptionConfigured(locale);
  const endpoint = await loadOwnedEndpoint(session.organizationId, endpointId, locale);

  const result = await sendTestDelivery({
    organizationId: session.organizationId,
    integrationId: endpoint.integrationId,
    endpointId: endpoint.id,
    triggeredByUserId: session.userId,
  });

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "developer_test.sent",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: {
      name: endpoint.name,
      ok: result.ok,
      responseStatus: result.run.responseStatus,
      durationMs: result.run.responseDurationMs,
      errorCode: result.run.errorCode,
    },
  });

  revalidatePath("/developers/console/tests");
  return { run: serializeRun(result.run), ok: result.ok };
}

export async function replayDeveloperTestRun(runId: string) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  ensureEncryptionConfigured(locale);

  const [original] = await db.select().from(integrationTestRuns).where(eq(integrationTestRuns.id, runId)).limit(1);
  if (!original || original.organizationId !== session.organizationId) throw new Error(MESSAGES[locale].testRunNotFound);

  const result = await replayTestRun({ runId, triggeredByUserId: session.userId });

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "developer_test.replayed",
    targetType: "integration_test_run",
    targetId: runId,
    metadata: { ok: result.ok, responseStatus: result.run.responseStatus, errorCode: result.run.errorCode },
  });

  revalidatePath("/developers/console/tests");
  return { run: serializeRun(result.run), ok: result.ok };
}
