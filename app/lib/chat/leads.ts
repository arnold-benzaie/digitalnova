import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { crmClients } from "@/db/schema";
import type { ChatContext } from "@/lib/chat/context";

export type ChatLeadInput = {
  fullName: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  country?: string | null;
  message: string;
};

/**
 * Reuses `crmClients` exactly as the CRM module already does — no
 * separate `chat_leads` table. `stage: "lead"`, `source: "chat widget"`,
 * matching the existing free-text `source` convention (e.g. "site web",
 * "recommandation", "salon" — see db/schema.ts's own comment on that
 * column). `organizationId` stays null for an anonymous visitor (a cold
 * lead has no PUBLIC-MAP organization yet, same as every other CRM lead
 * created before onboarding).
 *
 * Deduplication: a case-insensitive exact email match against an
 * existing, non-archived `crmClients` row is treated as "the same
 * prospect contacting us again" — its contact details are refreshed and
 * the new message appended to `notes` rather than creating a second row.
 * This is a deliberately narrow, reliable match (exact email only, never
 * fuzzy name matching, which would risk merging two different people).
 */
export async function captureLead(context: ChatContext, input: ChatLeadInput): Promise<{ crmClientId: string; reused: boolean }> {
  const email = input.email.trim().toLowerCase();

  const [existing] = await db
    .select({ id: crmClients.id, notes: crmClients.notes })
    .from(crmClients)
    .where(sql`lower(${crmClients.email}) = ${email} AND ${crmClients.archivedAt} IS NULL`)
    .limit(1);

  if (existing) {
    const appendedNote = `[Chat widget] ${input.message}`.slice(0, 2000);
    const mergedNotes = existing.notes ? `${existing.notes}\n\n${appendedNote}` : appendedNote;
    await db
      .update(crmClients)
      .set({
        contactName: input.fullName,
        phone: input.phone ?? undefined,
        country: input.country ?? undefined,
        notes: mergedNotes,
      })
      .where(eq(crmClients.id, existing.id));
    return { crmClientId: existing.id, reused: true };
  }

  const [created] = await db
    .insert(crmClients)
    .values({
      name: input.company?.trim() || input.fullName,
      contactName: input.fullName,
      email,
      phone: input.phone ?? null,
      country: input.country ?? null,
      preferredLocale: context.locale,
      stage: "lead",
      source: "chat widget",
      notes: `[Chat widget] ${input.message}`.slice(0, 2000),
      organizationId: context.kind === "authenticated" ? context.organizationId : null,
    })
    .returning({ id: crmClients.id });

  return { crmClientId: created.id, reused: false };
}
