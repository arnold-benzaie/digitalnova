"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { interactions } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { clientRequired: "Client requis.", summaryRequired: "Résumé requis." },
  en: { clientRequired: "Client required.", summaryRequired: "Summary required." },
} as const;

export async function createInteraction(formData: FormData) {
  const locale = await getLocale();
  const clientId = formData.get("clientId");
  const summary = formData.get("summary");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error(MESSAGES[locale].clientRequired);
  }
  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error(MESSAGES[locale].summaryRequired);
  }

  const type = formData.get("type");

  const [interaction] = await db
    .insert(interactions)
    .values({
      clientId,
      type: typeof type === "string" && type ? type : "note",
      summary: summary.trim(),
      createdBy: (formData.get("createdBy") as string) || null,
    })
    .returning();

  await logCrmAudit({
    action: "crm.interaction_logged",
    targetType: "interaction",
    targetId: interaction.id,
    clientId,
    metadata: { type: interaction.type, summary: interaction.summary },
  });

  revalidatePath(`/admin/crm/clients/${clientId}`);
}
