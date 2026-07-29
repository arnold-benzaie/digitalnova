"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { integrationTestRuns, webhookEndpoints } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireAdminRole } from "@/lib/dev-role";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import { previewTestEvent, replayTestRun, runWorkerNow, sendTestDelivery } from "@/lib/integrations/test-runner";

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

async function requireAdminSession() {
  await requireAdminRole();
  return requireSession();
}

function ensureEncryptionConfigured(locale: Locale) {
  if (!process.env.INTEGRATION_SECRET_ENCRYPTION_KEY) {
    throw new Error(MESSAGES[locale].encryptionNotConfigured);
  }
}

async function loadEndpointOrThrow(endpointId: string, locale: Locale) {
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpointId)).limit(1);
  if (!endpoint) throw new Error(MESSAGES[locale].endpointNotFound);
  return endpoint;
}

export type SerializedTestRun = {
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

function serializeRun(run: typeof integrationTestRuns.$inferSelect): SerializedTestRun {
  return { ...run, createdAt: run.createdAt.toISOString() };
}

export async function previewTestEventAction(organizationId: string, endpointId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  ensureEncryptionConfigured(locale);
  const endpoint = await loadEndpointOrThrow(endpointId, locale);

  const result = await previewTestEvent({
    organizationId,
    integrationId: endpoint.integrationId,
    endpointId: endpoint.id,
    triggeredByUserId: session.userId,
  });

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "integration_test.previewed",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name, eventType: result.run.eventType },
  });

  revalidatePath(`/admin/integrations/${organizationId}/tests`);
  return { run: serializeRun(result.run), headers: result.headers };
}

export async function sendTestDeliveryAction(organizationId: string, endpointId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  ensureEncryptionConfigured(locale);
  const endpoint = await loadEndpointOrThrow(endpointId, locale);

  const result = await sendTestDelivery({
    organizationId,
    integrationId: endpoint.integrationId,
    endpointId: endpoint.id,
    triggeredByUserId: session.userId,
  });

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "integration_test.sent",
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

  revalidatePath(`/admin/integrations/${organizationId}/tests`);
  return { run: serializeRun(result.run), ok: result.ok };
}

export async function replayTestRunAction(organizationId: string, runId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  ensureEncryptionConfigured(locale);

  const [original] = await db.select().from(integrationTestRuns).where(eq(integrationTestRuns.id, runId)).limit(1);
  if (!original || original.organizationId !== organizationId) throw new Error(MESSAGES[locale].testRunNotFound);

  const result = await replayTestRun({ runId, triggeredByUserId: session.userId });

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "integration_test.replayed",
    targetType: "integration_test_run",
    targetId: runId,
    metadata: { ok: result.ok, responseStatus: result.run.responseStatus, errorCode: result.run.errorCode },
  });

  revalidatePath(`/admin/integrations/${organizationId}/tests`);
  return { run: serializeRun(result.run), ok: result.ok };
}

/** Manually triggers the platform-wide outbox worker — processes due
 * deliveries across every organization/endpoint, not only this one. The
 * confirmation dialog shown before calling this action must say so
 * explicitly (see components/integrations/tests/trigger-worker-panel.tsx). */
export async function triggerWorkerNowAction(organizationId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  ensureEncryptionConfigured(locale);

  const result = await runWorkerNow();

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "integration_worker.triggered_manually",
    targetType: "integration_worker",
    metadata: { scope: "global", outbox: result.outbox, deliveries: result.deliveries },
  });

  revalidatePath(`/admin/integrations/${organizationId}/tests`);
  return result;
}
