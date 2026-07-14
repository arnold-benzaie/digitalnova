"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getOrCreateDevUser } from "@/lib/dev-user";

export async function updateProfile(formData: FormData) {
  const fullName = formData.get("fullName");
  const email = formData.get("email");
  if (typeof fullName !== "string" || typeof email !== "string" || !email.trim()) {
    throw new Error("Nom et email requis.");
  }

  const user = await getOrCreateDevUser();
  await db
    .update(users)
    .set({ fullName: fullName.trim() || null, email: email.trim() })
    .where(eq(users.id, user.id));

  revalidatePath("/dashboard/settings");
}

export async function updateOrganizationName(formData: FormData) {
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Le nom de l'organisation est requis.");
  }

  const org = await getOrCreateDevOrganization();
  await db.update(organizations).set({ name: name.trim() }).where(eq(organizations.id, org.id));

  await logAudit({
    organizationId: org.id,
    action: "organization.renamed",
    targetType: "organization",
    targetId: org.id,
    metadata: { name: name.trim() },
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/admin");
}

export async function setEmailNotificationsEnabled(enabled: boolean) {
  const org = await getOrCreateDevOrganization();
  await db.update(organizations).set({ emailNotificationsEnabled: enabled }).where(eq(organizations.id, org.id));

  revalidatePath("/dashboard/settings");
}
