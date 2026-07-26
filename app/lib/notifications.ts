import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, organizations } from "@/db/schema";
import { renderNotificationFr } from "@/lib/i18n/notification-templates";
import { userPendingCreatedEnvelope } from "@/lib/integrations/contracts";
import { enqueueIntegrationEvent } from "@/lib/integrations/outbox";

type NotifyInput = {
  organizationId: string;
  type: string;
  /** Structured data used to render this notification per-locale later
   * (see lib/i18n/notification-templates.ts) — required for every type
   * that has a template there. Types with no template (e.g. a dynamic
   * "fastspring.<event>" suffix) fall back to a plain, always-French
   * title derived from `type` itself. */
  metadata: Record<string, unknown>;
  /** Verbatim body override, for content that's data rather than
   * translatable UI text — a user's own message, an AI-generated audit or
   * onboarding summary. Stored exactly as given and never re-rendered by
   * locale (the matching template must omit `body` for this to apply). */
  rawBody?: string;
};

/**
 * In-app notification center only — email delivery is deferred until an
 * email provider (Resend/Postmark, per the architecture plan) is wired up.
 * Stores BOTH a canonical French title/body (computed once here, via the
 * same template every later re-render uses — never a second, hand-written
 * copy) AND the structured `metadata` those templates need, so
 * lib/i18n/notification-templates.ts's renderNotification() can re-render
 * the same row in English at read time without ever re-writing the row.
 */
export async function notify(input: NotifyInput) {
  const rendered = renderNotificationFr(input.type, input.metadata);
  await db.insert(notifications).values({
    organizationId: input.organizationId,
    type: input.type,
    title: rendered?.title ?? input.type,
    body: input.rawBody ?? rendered?.body,
    metadata: input.metadata,
  });
}

/**
 * Resolves the single internal PUBLIC-MAP organization used to route
 * platform-level admin notifications (e.g. "new pending user") that don't
 * belong to any client organization. Deterministic by construction: the
 * DB has a partial unique index (organizations_is_internal_unique)
 * guaranteeing at most one row can ever have is_internal = true, so this
 * can never silently fall back to "the first organization" — either
 * exactly one row matches, or none does. Setting this flag is a one-time
 * data operation (scripts/backfill-user-approval-status.mjs), not
 * something application code ever writes.
 */
type NotificationExecutor = Pick<typeof db, "select" | "insert">;

export async function getInternalOrganizationId(executor: Pick<typeof db, "select"> = db): Promise<string | null> {
  const [org] = await executor.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  return org?.id ?? null;
}

/**
 * Fires at most once per new pending user, ever — see lib/session.ts,
 * which only calls this from the branch that only runs the very first
 * time a given Clerk user's row is created (onConflictDoNothing means
 * every later sign-in skips it entirely). The partial unique index
 * notifications_pending_user_unique is defense-in-depth against that
 * same guarantee failing under some future refactor or concurrent
 * request, not the primary dedup mechanism.
 */
export async function createPendingUserNotificationAndEvent(
  executor: NotificationExecutor,
  user: { id: string; email: string; fullName: string | null },
) {
  const internalOrgId = await getInternalOrganizationId(executor);
  if (!internalOrgId) {
    console.warn(
      "[notifications] Aucune organisation interne (is_internal) configurée — notification pending non créée.",
    );
    return null;
  }

  const name = user.fullName ?? user.email;
  const rendered = renderNotificationFr("user.pending_approval", { name });

  const [createdNotification] = await executor
    .insert(notifications)
    .values({
      organizationId: internalOrgId,
      type: "user.pending_approval",
      title: rendered?.title ?? "Nouvel utilisateur en attente d'approbation",
      body: rendered?.body,
      metadata: { userId: user.id, name },
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id, createdAt: notifications.createdAt });

  // Only the concurrent request that actually inserted the unique internal
  // notification receives a row here. Every loser returns without emitting,
  // so the notification UUID is both the stable eventId and the at-most-once
  // gate for the outbound webhook.
  if (!createdNotification) return null;

  const envelope = userPendingCreatedEnvelope({
    id: createdNotification.id,
    occurredAt: createdNotification.createdAt,
    userId: user.id,
    displayName: user.fullName?.trim() || "Utilisateur en attente",
  });

  await enqueueIntegrationEvent(executor, {
    ...envelope,
    organizationId: internalOrgId,
    aggregateType: "user",
    aggregateId: user.id,
  });

  return { notification: createdNotification, event: envelope };
}

/** Compatibility helper for non-registration callers and isolated tests. */
export async function notifyPendingUserRegistered(user: { id: string; email: string; fullName: string | null }) {
  return db.transaction((tx) => createPendingUserNotificationAndEvent(tx, user));
}
