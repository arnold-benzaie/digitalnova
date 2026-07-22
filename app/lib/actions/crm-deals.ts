"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { dispatchWebhookEvent } from "@/lib/webhooks";

const STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;

export async function createDeal(formData: FormData) {
  const clientId = formData.get("clientId");
  const title = formData.get("title");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error("Client requis.");
  }
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Titre requis.");
  }

  const valueRaw = formData.get("valueEuros");
  const valueEuros = typeof valueRaw === "string" && valueRaw.trim() ? Math.max(0, parseInt(valueRaw, 10) || 0) : 0;
  const expectedCloseRaw = formData.get("expectedCloseDate");

  const [deal] = await db
    .insert(deals)
    .values({
      clientId,
      title: title.trim(),
      valueEuros,
      expectedCloseDate:
        typeof expectedCloseRaw === "string" && expectedCloseRaw ? new Date(expectedCloseRaw) : null,
    })
    .returning();

  await logCrmAudit({
    action: "crm.deal_created",
    targetType: "deal",
    targetId: deal.id,
    clientId: deal.clientId,
    metadata: { title: deal.title, valueEuros: deal.valueEuros },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/pipeline");
  revalidatePath(`/admin/crm/clients/${clientId}`);
}

export async function updateDealStage(id: string, stage: string) {
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    throw new Error("Étape invalide.");
  }

  const [deal] = await db.update(deals).set({ stage }).where(eq(deals.id, id)).returning();

  await logCrmAudit({
    action: "crm.deal_stage_changed",
    targetType: "deal",
    targetId: id,
    clientId: deal?.clientId,
    metadata: { stage },
  });

  if (deal && (stage === "won" || stage === "lost")) {
    await dispatchWebhookEvent(`deal.${stage}`, { dealId: deal.id, clientId: deal.clientId, valueEuros: deal.valueEuros });
  }

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/pipeline");
  if (deal) revalidatePath(`/admin/crm/clients/${deal.clientId}`);
}

export async function updateDeal(id: string, formData: FormData) {
  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Titre requis.");
  }

  const valueRaw = formData.get("valueEuros");
  const valueEuros = typeof valueRaw === "string" && valueRaw.trim() ? Math.max(0, parseInt(valueRaw, 10) || 0) : 0;
  const expectedCloseRaw = formData.get("expectedCloseDate");

  const [deal] = await db
    .update(deals)
    .set({
      title: title.trim(),
      valueEuros,
      expectedCloseDate: typeof expectedCloseRaw === "string" && expectedCloseRaw ? new Date(expectedCloseRaw) : null,
    })
    .where(eq(deals.id, id))
    .returning();
  if (!deal) throw new Error("Opportunité introuvable.");

  await logCrmAudit({
    action: "crm.deal_updated",
    targetType: "deal",
    targetId: id,
    clientId: deal.clientId,
    metadata: { title: deal.title, valueEuros: deal.valueEuros },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/pipeline");
  revalidatePath(`/admin/crm/clients/${deal.clientId}`);
  return deal;
}

export async function deleteDeal(id: string) {
  const [deal] = await db.delete(deals).where(eq(deals.id, id)).returning();
  if (!deal) throw new Error("Opportunité introuvable.");

  await logCrmAudit({
    action: "crm.deal_deleted",
    targetType: "deal",
    targetId: id,
    clientId: deal.clientId,
    metadata: { title: deal.title },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/pipeline");
  revalidatePath(`/admin/crm/clients/${deal.clientId}`);
}
