"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { getDevRole } from "@/lib/dev-role";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { notify } from "@/lib/notifications";

export async function sendMessage(formData: FormData) {
  const body = formData.get("body");
  if (typeof body !== "string" || body.trim().length === 0) {
    throw new Error("Le message ne peut pas être vide.");
  }

  const org = await getOrCreateDevOrganization();
  const role = await getDevRole();
  const senderRole = role === "client" ? "client" : "staff";
  const senderName = senderRole === "client" ? "Vous (client)" : "Votre conseiller Public Maps";

  await db.insert(messages).values({
    organizationId: org.id,
    senderRole,
    senderName,
    body: body.trim(),
  });

  await notify({
    organizationId: org.id,
    type: "message.received",
    title: senderRole === "client" ? "Nouveau message du client" : "Nouveau message de votre conseiller",
    body: body.trim().slice(0, 140),
  });

  revalidatePath("/dashboard/messages");
  revalidatePath("/admin/messages");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}
