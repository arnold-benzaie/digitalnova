"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { calendarEvents } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { titleRequired: "Titre requis.", startRequired: "Date de début requise.", eventNotFound: "Événement introuvable." },
  en: { titleRequired: "Title required.", startRequired: "Start date required.", eventNotFound: "Event not found." },
} as const;

export async function createCalendarEvent(formData: FormData) {
  const locale = await getLocale();
  const title = formData.get("title");
  const startAtRaw = formData.get("startAt");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error(MESSAGES[locale].titleRequired);
  }
  if (typeof startAtRaw !== "string" || !startAtRaw) {
    throw new Error(MESSAGES[locale].startRequired);
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

  await logCrmAudit({
    action: "crm.event_created",
    targetType: "calendar_event",
    targetId: event.id,
    clientId: event.clientId ?? undefined,
    metadata: { title: event.title },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/calendar");
  if (event.clientId) revalidatePath(`/admin/crm/clients/${event.clientId}`);
}

/** Full edit — title/description/type/start/end. */
export async function updateCalendarEvent(id: string, formData: FormData) {
  const locale = await getLocale();
  const title = formData.get("title");
  const startAtRaw = formData.get("startAt");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error(MESSAGES[locale].titleRequired);
  }
  if (typeof startAtRaw !== "string" || !startAtRaw) {
    throw new Error(MESSAGES[locale].startRequired);
  }

  const endAtRaw = formData.get("endAt");
  const type = formData.get("type");

  const [event] = await db
    .update(calendarEvents)
    .set({
      title: title.trim(),
      description: (formData.get("description") as string) || null,
      startAt: new Date(startAtRaw),
      endAt: typeof endAtRaw === "string" && endAtRaw ? new Date(endAtRaw) : null,
      type: typeof type === "string" && type ? type : "meeting",
    })
    .where(eq(calendarEvents.id, id))
    .returning();
  if (!event) throw new Error(MESSAGES[locale].eventNotFound);

  await logCrmAudit({
    action: "crm.event_updated",
    targetType: "calendar_event",
    targetId: id,
    clientId: event.clientId ?? undefined,
    metadata: { title: event.title },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/calendar");
  if (event.clientId) revalidatePath(`/admin/crm/clients/${event.clientId}`);
  return event;
}

export async function deleteCalendarEvent(id: string) {
  const locale = await getLocale();
  const [event] = await db.delete(calendarEvents).where(eq(calendarEvents.id, id)).returning();
  if (!event) throw new Error(MESSAGES[locale].eventNotFound);

  await logCrmAudit({
    action: "crm.event_deleted",
    targetType: "calendar_event",
    targetId: id,
    clientId: event.clientId ?? undefined,
    metadata: { title: event.title },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/calendar");
  if (event.clientId) revalidatePath(`/admin/crm/clients/${event.clientId}`);
}
