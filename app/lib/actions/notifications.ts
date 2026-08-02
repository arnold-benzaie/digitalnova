"use server";

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { requireSession } from "@/lib/session";

/**
 * A notification row is visible to the caller when either: it broadcasts
 * to their whole organization (userId is null), or it's personal to them
 * specifically (userId = them) — see the `userId` doc comment on notify()
 * in lib/notifications.ts. Shared by every read/mutate query below so the
 * visibility rule can't drift between call sites.
 */
function visibleToViewer(organizationId: string, userId: string) {
  return or(and(eq(notifications.organizationId, organizationId), isNull(notifications.userId)), eq(notifications.userId, userId));
}

export async function markAllNotificationsRead() {
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  await db.update(notifications).set({ read: true }).where(visibleToViewer(org.id, session.userId));

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}

/**
 * Scoped to rows the caller can actually see (and(eq(id), visibleToViewer))
 * rather than trusting the id alone — same defense-in-depth as every other
 * scoped mutation in this app, even though the id itself is a uuid an
 * attacker couldn't realistically guess. This is also what stops user A
 * from marking user B's personal notification as read: B's row never
 * matches visibleToViewer(org, A's userId).
 */
export async function markNotificationRead(id: string) {
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), visibleToViewer(org.id, session.userId)));

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
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
    .where(visibleToViewer(org.id, session.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(5);
}

/**
 * Full content for specific ids the poller just identified as new — never
 * trusts the caller's ids alone (visibleToViewer still applies), so this
 * can't be used to read another user's personal notification by guessing
 * its id either.
 */
export async function getNotificationsById(ids: string[]) {
  if (ids.length === 0) return [];
  const [org, session] = await Promise.all([getOrCreateDevOrganization(), requireSession()]);
  return db
    .select()
    .from(notifications)
    .where(and(inArray(notifications.id, ids), visibleToViewer(org.id, session.userId)));
}
