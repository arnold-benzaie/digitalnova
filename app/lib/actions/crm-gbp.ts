"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmClients, organizations } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { requireStaffRole } from "@/lib/dev-role";
import { replyToReview, syncGbpData } from "@/lib/actions/gbp";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { clientNotFound: "Client introuvable." },
  en: { clientNotFound: "Client not found." },
} as const;

/**
 * crmClients.organizationId is nullable — a lead has no platform tenant
 * until they actually need one. Google Business Profile is modeled against
 * `organizations` (see db/schema.ts on `locations`, already 1-to-many —
 * "several establishments per client" is the existing design, not
 * something new), so the first time staff connects GBP from the CRM side,
 * this creates that organization on demand and links it back.
 */
export async function getOrCreateOrganizationForClient(clientId: string) {
  await requireStaffRole();
  const locale = await getLocale();
  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, clientId)).limit(1);
  if (!client) throw new Error(MESSAGES[locale].clientNotFound);

  if (client.organizationId) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, client.organizationId)).limit(1);
    if (org) return org;
  }

  const [org] = await db.insert(organizations).values({ name: client.name }).returning();
  await db.update(crmClients).set({ organizationId: org.id }).where(eq(crmClients.id, clientId));

  await logCrmAudit({
    action: "crm.client_linked_to_organization",
    targetType: "crm_client",
    targetId: clientId,
    clientId,
    metadata: { organizationId: org.id },
  });

  return org;
}

export async function syncGbpDataForClient(clientId: string) {
  await requireStaffRole();
  const org = await getOrCreateOrganizationForClient(clientId);
  await syncGbpData(org.id);
  revalidatePath(`/admin/crm/clients/${clientId}/gbp`);
}

export async function replyToReviewForClient(clientId: string, reviewId: string, replyText: string) {
  await requireStaffRole();
  await replyToReview(reviewId, replyText);
  revalidatePath(`/admin/crm/clients/${clientId}/gbp`);
}
