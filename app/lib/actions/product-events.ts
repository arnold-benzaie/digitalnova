"use server";

import { requireSession } from "@/lib/session";
import { type ProductEventType, PRODUCT_EVENT_TYPES, recordProductEvent } from "@/lib/product-events";

/**
 * The one client-reachable entry point for product-activity tracking
 * (used today by components/product-activity-tracker.tsx for page_view).
 * The browser may send at most `eventType`/`path`/`entityType`/`entityId`/
 * a small `metadata` object — organizationId/userId are NEVER accepted
 * here, they're resolved exclusively from requireSession() below, so a
 * client cannot inject another organization's or user's id no matter what
 * it puts in the request body.
 */
export async function trackClientEvent(input: {
  eventType: string;
  path?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  if (!(PRODUCT_EVENT_TYPES as readonly string[]).includes(input.eventType)) return;
  const session = await requireSession();
  await recordProductEvent({
    organizationId: session.organizationId,
    userId: session.userId,
    eventType: input.eventType as ProductEventType,
    path: input.path,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
  });
}
