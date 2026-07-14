"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { calendarEvents } from "@/db/schema";
import { logAudit } from "@/lib/audit";

export async function createCalendarEvent(formData: FormData) {
  const title = formData.get("title");
  const startAtRaw = formData.get("startAt");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Titre requis.");
  }
  if (typeof startAtRaw !== "string" || !startAtRaw) {
    throw new Error("Date de début requise.");
  }

  const clientId = formData.get("clientId");
  const endAtRaw = formData.get("endAt");
  const type = formData.get("type");

  const [event] = await db
    .insert(calendarEvents)
    .values({
      title: title.trim(),
      description: (formData.get("description") as string) || null,
      clientId: typeof clientId === "string" && clientId ? clientId : null,
      startAt: new Date(startAtRaw),
      endAt: typeof endAtRaw === "string" && endAtRaw ? new Date(endAtRaw) : null,
      type: typeof type === "string" && type ? type : "meeting",
    })
    .returning();

  await logAudit({
    action: "crm.event_created",
    targetType: "calendar_event",
    targetId: event.id,
    metadata: { title: event.title },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/calendar");
  if (event.clientId) revalidatePath(`/admin/crm/clients/${event.clientId}`);
}
