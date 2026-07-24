"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contracts } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { getESignProvider } from "@/lib/esign";
import { dispatchWebhookEvent } from "@/lib/webhooks";

export async function createContract(formData: FormData) {
  const clientId = formData.get("clientId");
  const title = formData.get("title");
  const content = formData.get("content");
  if (typeof clientId !== "string" || !clientId) throw new Error("Client requis.");
  if (typeof title !== "string" || !title.trim()) throw new Error("Titre requis.");
  if (typeof content !== "string" || !content.trim()) throw new Error("Contenu requis.");

  const dealId = formData.get("dealId");

  const [contract] = await db
    .insert(contracts)
    .values({
      clientId,
      dealId: typeof dealId === "string" && dealId ? dealId : null,
      title: title.trim(),
      content: content.trim(),
      signerName: (formData.get("signerName") as string) || null,
      signerEmail: (formData.get("signerEmail") as string) || null,
    })
    .returning();

  await logCrmAudit({
    action: "crm.contract_created",
    targetType: "contract",
    targetId: contract.id,
    clientId,
    metadata: { title: contract.title },
  });

  revalidatePath(`/admin/crm/clients/${clientId}`);
  revalidatePath("/admin/crm/contracts");
}

/** Only draft contracts can be edited — once sent/signed, the e-sign
 * provider already has that exact content, so editing here would silently
 * desync from what the signer actually saw. */
export async function updateContract(id: string, formData: FormData) {
  const title = formData.get("title");
  const content = formData.get("content");
  if (typeof title !== "string" || !title.trim()) throw new Error("Titre requis.");
  if (typeof content !== "string" || !content.trim()) throw new Error("Contenu requis.");

  const [existing] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  if (!existing) throw new Error("Contrat introuvable.");
  if (existing.status !== "draft") {
    throw new Error("Seuls les contrats en brouillon peuvent être modifiés.");
  }

  const [contract] = await db
    .update(contracts)
    .set({
      title: title.trim(),
      content: content.trim(),
      signerName: (formData.get("signerName") as string) || null,
      signerEmail: (formData.get("signerEmail") as string) || null,
    })
    .where(eq(contracts.id, id))
    .returning();

  await logCrmAudit({
    action: "crm.contract_updated",
    targetType: "contract",
    targetId: id,
    clientId: contract.clientId,
    metadata: { title: contract.title },
  });

  revalidatePath(`/admin/crm/clients/${contract.clientId}`);
  revalidatePath("/admin/crm/contracts");
  return contract;
}

export async function sendContractForSignature(id: string) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  if (!contract) throw new Error("Contrat introuvable.");
  if (!contract.signerName || !contract.signerEmail) {
    throw new Error("Renseignez le nom et l'email du signataire avant l'envoi.");
  }

  const provider = getESignProvider();
  const request = await provider.sendForSignature({
    title: contract.title,
    content: contract.content,
    signerName: contract.signerName,
    signerEmail: contract.signerEmail,
  });

  await db
    .update(contracts)
    .set({ status: "sent", sentAt: new Date(), providerRequestId: request.providerRequestId })
    .where(eq(contracts.id, id));

  await logCrmAudit({
    action: "crm.contract_sent",
    targetType: "contract",
    targetId: id,
    clientId: contract.clientId,
  });

  await dispatchWebhookEvent("contract.sent", { contractId: id, clientId: contract.clientId });

  revalidatePath(`/admin/crm/clients/${contract.clientId}`);
  revalidatePath("/admin/crm/contracts");
}

export async function simulateContractSignature(id: string) {
  const [contract] = await db
    .update(contracts)
    .set({ status: "signed", signedAt: new Date() })
    .where(eq(contracts.id, id))
    .returning();
  if (!contract) throw new Error("Contrat introuvable.");

  await logCrmAudit({
    action: "crm.contract_signed",
    targetType: "contract",
    targetId: id,
    clientId: contract.clientId,
  });

  await dispatchWebhookEvent("contract.signed", { contractId: id, clientId: contract.clientId });

  revalidatePath(`/admin/crm/clients/${contract.clientId}`);
  revalidatePath("/admin/crm/contracts");
}
