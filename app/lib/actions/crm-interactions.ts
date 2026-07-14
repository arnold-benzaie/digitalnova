"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { interactions } from "@/db/schema";
import { logAudit } from "@/lib/audit";

export async function createInteraction(formData: FormData) {
  const clientId = formData.get("clientId");
  const summary = formData.get("summary");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error("Client requis.");
  }
  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error("Résumé requis.");
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

  await logAudit({
    action: "crm.interaction_logged",
    targetType: "interaction",
    targetId: interaction.id,
    metadata: { type: interaction.type },
  });

  revalidatePath(`/admin/crm/clients/${clientId}`);
}
