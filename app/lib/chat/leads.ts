import "server-only";
import { eq, sql } from "drizzle-orm";
import { parsePhoneNumberFromString } from "libphonenumber-js/core";
// Same "core" build + explicit metadata as validation.ts — see that
// file's comment: the top-level `libphonenumber-js` package triggers a
// tsx/Node ESM-CJS interop bug under this project's test runner, and no
// `with { type: "json" }` assertion (this subpath's own "import"
// condition already resolves to a plain .js module, not raw JSON).
import metadata from "libphonenumber-js/metadata.min.json";
import { db } from "@/db";
import { crmClients } from "@/db/schema";
import type { ChatContext } from "@/lib/chat/context";
import { REQUEST_TYPE_LABELS_FR, type RequestTypeKey } from "@/lib/chat/request-type-catalog";

// §Phase 1F — crmClients.phone already stores the E.164 number itself
// (no new column needed); this only derives a human-readable "country +
// dial code" line for `notes`, the same place requestType/preferredDate
// already live (see buildNotesEntry below) — no migration either way.
// Intl.DisplayNames (built into Node, zero extra dependency) turns the
// ISO country libphonenumber-js already parsed out of the number into a
// localized name — always French here, matching REQUEST_TYPE_LABELS_FR's
// own precedent (staff read the CRM in French regardless of the
// visitor's own conversation language).
function describePhoneCountry(phone: string): string | null {
  const parsed = parsePhoneNumberFromString(phone, metadata);
  if (!parsed?.country) return null;
  try {
    const countryName = new Intl.DisplayNames(["fr"], { type: "region" }).of(parsed.country) ?? parsed.country;
    return `${countryName} (+${parsed.countryCallingCode})`;
  } catch {
    return `+${parsed.countryCallingCode}`;
  }
}

export type ChatLeadInput = {
  fullName: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  country?: string | null;
  message: string;
  // §Phase 1D — all optional at THIS function's boundary (unlike the API
  // route's own leadSubmitSchema, which requires requestType): keeps
  // every existing direct caller (unit tests, any future internal use)
  // working unchanged. Only ever appended to `notes` as a clearly
  // labeled, human-readable PREFERENCE — never turned into a real
  // reservation/booking record, since no calendar system is connected.
  requestType?: RequestTypeKey | null;
  preferredDate?: string | null;
  preferredTimeSlot?: string | null;
};

function buildNotesEntry(input: ChatLeadInput): string {
  const lines = [`[Chat widget] ${input.message}`];
  if (input.requestType) lines.push(`Type de demande : ${REQUEST_TYPE_LABELS_FR[input.requestType]}`);
  if (input.preferredDate) lines.push(`Date souhaitée (préférence, non confirmée) : ${input.preferredDate}`);
  if (input.preferredTimeSlot) lines.push(`Créneau souhaité (préférence, non confirmée) : ${input.preferredTimeSlot}`);
  const phoneCountry = input.phone ? describePhoneCountry(input.phone) : null;
  if (phoneCountry) lines.push(`Téléphone — pays : ${phoneCountry}`);
  return lines.join("\n").slice(0, 2000);
}

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
    const appendedNote = buildNotesEntry(input);
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
      notes: buildNotesEntry(input),
      organizationId: context.kind === "authenticated" ? context.organizationId : null,
    })
    .returning({ id: crmClients.id });

  return { crmClientId: created.id, reused: false };
}
