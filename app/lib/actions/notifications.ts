"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { notificationVisibilityWhere } from "@/lib/notification-visibility";
import { requireSession } from "@/lib/session";

export async function markAllNotificationsRead() {
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  await db.update(notifications).set({ read: true }).where(notificationVisibilityWhere(org.id, session.userId, session.role));

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}

/**
 * Scoped to rows the caller can actually see (and(eq(id), visibility))
 * rather than trusting the id alone — same defense-in-depth as every other
 * scoped mutation in this app, even though the id itself is a uuid an
 * attacker couldn't realistically guess. This is also what stops user A
 * from marking user B's personal notification as read, or a client from
 * marking a staff-only notification as read by id even if they somehow
 * learned it: neither ever matches notificationVisibilityWhere(org, A, A's role).
 */
export async function markNotificationRead(id: string) {
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), notificationVisibilityWhere(org.id, session.userId, session.role)));

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}

/**
 * Hard delete — notifications have no downstream consumer (the durable
 * record of the underlying event already lives in auditLog via logAudit(),
 * called before every notify() that matters), so there's nothing to
 * preserve here. Single DELETE ... WHERE id = ? AND <visibility>, never a
 * SELECT-then-check-then-DELETE: the visibility predicate IS the
 * authorization, applied atomically by Postgres, so there's no window for
 * a race and no separate "is this mine" check to forget. Returns a plain
 * { deleted: boolean } — true only if a row actually matched — and never
 * throws or otherwise distinguishes "wrong id" from "someone else's id"
 * from "already deleted", so a caller can't use the response to probe
 * whether an id belongs to another user/organization.
 */
export async function deleteNotification(id: string): Promise<{ deleted: boolean }> {
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  const deletedRows = await db
    .delete(notifications)
    .where(and(eq(notifications.id, id), notificationVisibilityWhere(org.id, session.userId, session.role)))
    .returning({ id: notifications.id });

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");

  return { deleted: deletedRows.length > 0 };
}

/** Same predicate, plus read = true — bulk "clear my read notifications". */
export async function deleteAllReadNotifications(): Promise<{ deletedCount: number }> {
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  const deletedRows = await db
    .delete(notifications)
    .where(and(eq(notifications.read, true), notificationVisibilityWhere(org.id, session.userId, session.role)))
    .returning({ id: notifications.id });

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");

  return { deletedCount: deletedRows.length };
}

/**
 * Polled every ~12s by components/notification-live.tsx while the app
 * shell is mounted (see that file for the visibility-aware, cleaned-up-on-
 * unmount polling loop) — deliberately minimal (no title/body/metadata) so
 * a background tick with nothing new stays cheap. Once the poller diffs
 * these ids against what it's already seen and finds a genuinely new one,
 * it calls getNotificationsById() below for just that row's real content
 * (for the toast), and the server-rendered paths (AppShell, the
 * /notifications pages) pick up the rest on the router.refresh() that follows.
 */
export async function getLatestNotificationMeta(): Promise<{ id: string; createdAt: Date }[]> {
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  return db
    .select({ id: notifications.id, createdAt: notifications.createdAt })
    .from(notifications)
    .where(notificationVisibilityWhere(org.id, session.userId, session.role))
    .orderBy(desc(notifications.createdAt))
    .limit(5);
}

/**
 * Full content for specific ids the poller just identified as new — never
 * trusts the caller's ids alone (the visibility predicate still applies),
 * so this can't be used to read another user's personal or a client's
 * staff-only notification by guessing its id either.
 */
export async function getNotificationsById(ids: string[]) {
  if (ids.length === 0) return [];
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  return db
    .select()
    .from(notifications)
    .where(and(inArray(notifications.id, ids), notificationVisibilityWhere(org.id, session.userId, session.role)));
}
