"use server";

import { eq } from "drizzle-orm";
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
