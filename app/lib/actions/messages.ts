"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { getDevRole } from "@/lib/dev-role";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { notify } from "@/lib/notifications";
import { APP_NAME } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { emptyMessage: "Le message ne peut pas être vide." },
  en: { emptyMessage: "The message cannot be empty." },
} as const;

export async function sendMessage(formData: FormData) {
  const locale = await getLocale();
  const body = formData.get("body");
  if (typeof body !== "string" || body.trim().length === 0) {
    throw new Error(MESSAGES[locale].emptyMessage);
  }

  const org = await getOrCreateDevOrganization();
  const role = await getDevRole();
  const senderRole = role === "client" ? "client" : "staff";
  const senderName = senderRole === "client" ? "Vous (client)" : `Votre conseiller ${APP_NAME}`;

  await db.insert(messages).values({
    organizationId: org.id,
    senderRole,
    senderName,
    body: body.trim(),
  });

  await notify({
    organizationId: org.id,
    type: "message.received",
    metadata: { senderRole },
    rawBody: body.trim().slice(0, 140),
  });

  revalidatePath("/dashboard/messages");
  revalidatePath("/admin/messages");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}
