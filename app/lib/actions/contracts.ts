"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contracts } from "@/db/schema";
import { logAudit } from "@/lib/audit";
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

  await logAudit({
    action: "crm.contract_created",
    targetType: "contract",
    targetId: contract.id,
    metadata: { title: contract.title },
  });

  revalidatePath(`/admin/crm/clients/${clientId}`);
  revalidatePath("/admin/crm/contracts");
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

  await logAudit({
    action: "crm.contract_sent",
    targetType: "contract",
    targetId: id,
  });

  await dispatchWebhookEvent("contract.sent", { contractId: id, clientId: contract.clientId });

  revalidatePath(`/admin/crm/clients/${contract.clientId}`);
  revalidatePath("/admin/crm/contracts");
}

/** Demo-only: no real signer ever signs the mock request, so this simulates it. */
export async function simulateContractSignature(id: string) {
  const [contract] = await db
    .update(contracts)
    .set({ status: "signed", signedAt: new Date() })
    .where(eq(contracts.id, id))
    .returning();
  if (!contract) throw new Error("Contrat introuvable.");

  await logAudit({
    action: "crm.contract_signed",
    targetType: "contract",
    targetId: id,
  });

  await dispatchWebhookEvent("contract.signed", { contractId: id, clientId: contract.clientId });

  revalidatePath(`/admin/crm/clients/${contract.clientId}`);
  revalidatePath("/admin/crm/contracts");
}
