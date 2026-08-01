"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";

export async function markAllNotificationsRead() {
  const org = await getOrCreateDevOrganization();
  await db.update(notifications).set({ read: true }).where(eq(notifications.organizationId, org.id));

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}

/**
 * Scoped to the caller's own organization (and(eq(id), eq(organizationId)))
 * rather than trusting the id alone — same defense-in-depth as every other
 * organization-scoped mutation in this app, even though the id itself is a
 * uuid an attacker couldn't realistically guess.
 */
export async function markNotificationRead(id: string) {
  const org = await getOrCreateDevOrganization();
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.organizationId, org.id)));

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}
