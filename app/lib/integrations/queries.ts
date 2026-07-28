import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationApiKeys,
  integrationEvents,
  integrationTestRuns,
  integrations,
  organizations,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEndpoints,
  webhookSubscriptions,
} from "@/db/schema";
import { WEBHOOK_DELIVERY_STATUSES, type WebhookDeliveryStatus } from "@/lib/integrations/contracts";

/** Org picker (`/admin/integrations`) — one row per organization, with counts scoped through `integrations.organizationId`. */
export async function listOrganizationsWithIntegrationCounts() {
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      integrationCount: sql<number>`count(distinct ${integrations.id}) filter (where ${integrations.status} = 'active')::int`,
      endpointCount: sql<number>`count(distinct ${webhookEndpoints.id}) filter (where ${webhookEndpoints.status} = 'active')::int`,
    })
    .from(organizations)
    .leftJoin(integrations, eq(integrations.organizationId, organizations.id))
    .leftJoin(webhookEndpoints, eq(webhookEndpoints.integrationId, integrations.id))
    .groupBy(organizations.id)
    .orderBy(organizations.name);
}

export async function getOrganizationById(organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return org ?? null;
}

export type OrgIntegrationStats = {
  integrationCount: number;
  activeApiKeyCount: number;
  activeEndpointCount: number;
  pendingEventCount: number;
  lastDeliveryAt: Date | null;
  deliveriesByStatus: Record<WebhookDeliveryStatus, number>;
};

/**
 * Dashboard stats (`/admin/integrations/[organizationId]`) — every number is
 * derived from existing tables, no new schema. "Org-scoped" here always
 * means joining down through integrations.organizationId, since none of the
 * delivery/event tables carry a direct, always-populated org column of
 * their own (integrationEvents.organizationId is nullable and only used
 * for platform-wide events — see db/schema.ts).
 */
export async function getOrgIntegrationStats(organizationId: string): Promise<OrgIntegrationStats> {
  const since30d = new Date();
  since30d.setUTCDate(since30d.getUTCDate() - 30);

  const [[integrationRow], [apiKeyRow], [endpointRow], [pendingEventRow], [lastDeliveryRow], statusRows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(integrations)
      .where(eq(integrations.organizationId, organizationId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(integrationApiKeys)
      .innerJoin(integrations, eq(integrations.id, integrationApiKeys.integrationId))
      .where(and(eq(integrations.organizationId, organizationId), eq(integrationApiKeys.status, "active"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(webhookEndpoints)
      .innerJoin(integrations, eq(integrations.id, webhookEndpoints.integrationId))
      .where(and(eq(integrations.organizationId, organizationId), eq(webhookEndpoints.status, "active"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(integrationEvents)
      .where(and(eq(integrationEvents.organizationId, organizationId), eq(integrationEvents.status, "pending"))),
    db
      .select({ max: sql<Date | null>`max(${webhookDeliveries.deliveredAt})` })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .innerJoin(integrations, eq(integrations.id, webhookEndpoints.integrationId))
      .where(eq(integrations.organizationId, organizationId)),
    db
      .select({ status: webhookDeliveries.status, n: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .innerJoin(integrations, eq(integrations.id, webhookEndpoints.integrationId))
      .where(and(eq(integrations.organizationId, organizationId), gte(webhookDeliveries.createdAt, since30d)))
      .groupBy(webhookDeliveries.status),
  ]);

  const deliveriesByStatus = Object.fromEntries(WEBHOOK_DELIVERY_STATUSES.map((status) => [status, 0])) as Record<
    WebhookDeliveryStatus,
    number
  >;
  for (const row of statusRows) {
    if (row.status in deliveriesByStatus) deliveriesByStatus[row.status as WebhookDeliveryStatus] = row.n;
  }

  return {
    integrationCount: integrationRow?.n ?? 0,
    activeApiKeyCount: apiKeyRow?.n ?? 0,
    activeEndpointCount: endpointRow?.n ?? 0,
    pendingEventCount: pendingEventRow?.n ?? 0,
    lastDeliveryAt: lastDeliveryRow?.max ?? null,
    deliveriesByStatus,
  };
}

/** Webhooks list (`/admin/integrations/[organizationId]/webhooks`) — never
 * selects url/secret ciphertext columns, only `urlOrigin` (explicitly
 * documented on the schema as safe to display). */
export async function listWebhookEndpointsForOrg(organizationId: string) {
  return db
    .select({
      id: webhookEndpoints.id,
      name: webhookEndpoints.name,
      description: webhookEndpoints.description,
      urlOrigin: webhookEndpoints.urlOrigin,
      status: webhookEndpoints.status,
      lastDeliveryAt: webhookEndpoints.lastDeliveryAt,
      createdAt: webhookEndpoints.createdAt,
      subscribedEventCount: sql<number>`count(distinct ${webhookSubscriptions.eventType}) filter (where ${webhookSubscriptions.enabled})::int`,
    })
    .from(webhookEndpoints)
    .innerJoin(integrations, eq(integrations.id, webhookEndpoints.integrationId))
    .leftJoin(webhookSubscriptions, eq(webhookSubscriptions.endpointId, webhookEndpoints.id))
    .where(eq(integrations.organizationId, organizationId))
    .groupBy(webhookEndpoints.id)
    .orderBy(desc(webhookEndpoints.createdAt));
}

export async function getWebhookEndpointForOrg(organizationId: string, endpointId: string) {
  const [row] = await db
    .select({ endpoint: webhookEndpoints })
    .from(webhookEndpoints)
    .innerJoin(integrations, eq(integrations.id, webhookEndpoints.integrationId))
    .where(and(eq(webhookEndpoints.id, endpointId), eq(integrations.organizationId, organizationId)))
    .limit(1);
  return row?.endpoint ?? null;
}

export async function listWebhookEndpointSubscriptions(endpointId: string) {
  return db
    .select({ eventType: webhookSubscriptions.eventType, eventVersion: webhookSubscriptions.eventVersion, enabled: webhookSubscriptions.enabled })
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.endpointId, endpointId));
}

/** Recent delivery history for one endpoint's detail page — deliveries plus
 * every attempt for those deliveries, batched (not N+1). */
export async function listRecentDeliveriesForEndpoint(endpointId: string, limit = 20) {
  const deliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, endpointId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);

  if (deliveries.length === 0) return [];

  const attempts = await db
    .select()
    .from(webhookDeliveryAttempts)
    .where(inArray(webhookDeliveryAttempts.deliveryId, deliveries.map((d) => d.id)))
    .orderBy(webhookDeliveryAttempts.attemptNumber);

  return deliveries.map((delivery) => ({
    delivery,
    attempts: attempts.filter((a) => a.deliveryId === delivery.id),
  }));
}

/** Endpoint id/name pairs for the Journaux filter dropdown. */
export async function listWebhookEndpointOptionsForOrg(organizationId: string) {
  return db
    .select({ id: webhookEndpoints.id, name: webhookEndpoints.name })
    .from(webhookEndpoints)
    .innerJoin(integrations, eq(integrations.id, webhookEndpoints.integrationId))
    .where(eq(integrations.organizationId, organizationId))
    .orderBy(webhookEndpoints.name);
}

/** Org-wide, paginated, filterable delivery journal
 * (`/admin/integrations/[organizationId]/journaux`) — same
 * conditions-array + count-query + limit/offset shape as
 * app/admin/users/page.tsx. `webhookDeliveries.event` already carries the
 * event type string on the row itself (set by the outbox's fan-out step),
 * so no join to integrationEvents is needed just to show it. */
export async function listDeliveriesForOrg(
  organizationId: string,
  filters: { status?: WebhookDeliveryStatus; endpointId?: string; page: number; pageSize: number },
) {
  const conditions = [eq(integrations.organizationId, organizationId)];
  if (filters.status) conditions.push(eq(webhookDeliveries.status, filters.status));
  if (filters.endpointId) conditions.push(eq(webhookDeliveries.endpointId, filters.endpointId));

  const baseQuery = db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      responseStatus: webhookDeliveries.responseStatus,
      responseDurationMs: webhookDeliveries.responseDurationMs,
      lastErrorCode: webhookDeliveries.lastErrorCode,
      attemptCount: webhookDeliveries.attemptCount,
      createdAt: webhookDeliveries.createdAt,
      endpointId: webhookDeliveries.endpointId,
      endpointName: webhookEndpoints.name,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .innerJoin(integrations, eq(integrations.id, webhookEndpoints.integrationId))
    .where(and(...conditions));

  const [rows, totalRows] = await Promise.all([
    baseQuery
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .innerJoin(integrations, eq(integrations.id, webhookEndpoints.integrationId))
      .where(and(...conditions)),
  ]);

  return { rows, total: totalRows[0]?.count ?? 0 };
}

export async function getDeliveryAttempts(deliveryId: string) {
  return db
    .select()
    .from(webhookDeliveryAttempts)
    .where(eq(webhookDeliveryAttempts.deliveryId, deliveryId))
    .orderBy(webhookDeliveryAttempts.attemptNumber);
}

/** Batched attempts for every delivery shown on one Journaux page — same
 * two-query, no-N+1 shape as listRecentDeliveriesForEndpoint. */
export async function listDeliveryAttemptsForDeliveries(deliveryIds: string[]) {
  if (deliveryIds.length === 0) return [];
  return db
    .select()
    .from(webhookDeliveryAttempts)
    .where(inArray(webhookDeliveryAttempts.deliveryId, deliveryIds))
    .orderBy(webhookDeliveryAttempts.attemptNumber);
}

/** API Keys list (`/admin/integrations/[organizationId]/api-keys`) — never
 * selects `keyHash`: the list/detail views must only ever be able to show
 * `keyPrefix`/`lookupId`, never anything that could reconstruct or verify
 * against the real key. */
export async function listApiKeysForOrg(organizationId: string) {
  return db
    .select({
      id: integrationApiKeys.id,
      lookupId: integrationApiKeys.lookupId,
      keyPrefix: integrationApiKeys.keyPrefix,
      scopes: integrationApiKeys.scopes,
      status: integrationApiKeys.status,
      lastUsedAt: integrationApiKeys.lastUsedAt,
      expiresAt: integrationApiKeys.expiresAt,
      revokedAt: integrationApiKeys.revokedAt,
      createdAt: integrationApiKeys.createdAt,
    })
    .from(integrationApiKeys)
    .innerJoin(integrations, eq(integrations.id, integrationApiKeys.integrationId))
    .where(eq(integrations.organizationId, organizationId))
    .orderBy(desc(integrationApiKeys.createdAt));
}

/** Test run history (`/admin/integrations/[organizationId]/tests`) —
 * organizationId lives directly on integration_test_runs (unlike
 * webhookDeliveries), so no join is needed to scope by org; only the
 * endpoint name needs a join. */
export async function listTestRunsForOrg(organizationId: string, filters: { page: number; pageSize: number }) {
  const condition = eq(integrationTestRuns.organizationId, organizationId);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: integrationTestRuns.id,
        endpointId: integrationTestRuns.endpointId,
        endpointName: webhookEndpoints.name,
        mode: integrationTestRuns.mode,
        eventType: integrationTestRuns.eventType,
        eventVersion: integrationTestRuns.eventVersion,
        requestPayload: integrationTestRuns.requestPayload,
        responseStatus: integrationTestRuns.responseStatus,
        responseDurationMs: integrationTestRuns.responseDurationMs,
        errorCode: integrationTestRuns.errorCode,
        replayOfId: integrationTestRuns.replayOfId,
        createdAt: integrationTestRuns.createdAt,
      })
      .from(integrationTestRuns)
      .leftJoin(webhookEndpoints, eq(webhookEndpoints.id, integrationTestRuns.endpointId))
      .where(condition)
      .orderBy(desc(integrationTestRuns.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(integrationTestRuns).where(condition),
  ]);

  return { rows, total: totalRows[0]?.count ?? 0 };
}
