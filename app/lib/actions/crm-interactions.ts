"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmClients, deals, interactions } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { getLocale } from "@/lib/i18n/locale";
import { requireRadarAccess } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { requireCrmClientAccess } from "@/lib/crm-client-access";
import { isValidUuid } from "@/lib/api-v1/dto";

const TYPES = ["note", "call", "email", "meeting"] as const;
type InteractionType = (typeof TYPES)[number];

const DIRECTIONS = ["outbound", "inbound"] as const;
type Direction = (typeof DIRECTIONS)[number];

const OUTCOMES = ["positive", "neutral", "negative"] as const;
type Outcome = (typeof OUTCOMES)[number];

const MESSAGES = {
  fr: {
    clientRequired: "Client requis.",
    summaryRequired: "Résumé requis.",
    invalidType: "Type d'interaction invalide.",
    invalidDirection: "Direction invalide pour ce type d'interaction.",
    invalidOutcome: "Résultat invalide pour cette combinaison type/direction.",
    clientNotFound: "Client introuvable.",
    dealNotFound: "Deal introuvable.",
    doNotContact: "Ce client est marqué « ne pas contacter » — impossible d'enregistrer un contact sortant.",
  },
  en: {
    clientRequired: "Client required.",
    summaryRequired: "Summary required.",
    invalidType: "Invalid interaction type.",
    invalidDirection: "Invalid direction for this interaction type.",
    invalidOutcome: "Invalid outcome for this type/direction combination.",
    clientNotFound: "Client not found.",
    dealNotFound: "Deal not found.",
    doNotContact: "This client is marked do-not-contact — an outbound contact cannot be recorded.",
  },
} as const;

function normalizeSelect(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * AI Commercial Radar / Phase 1F-A.2 — the canonical, Server-Action-
 * enforced write matrix for type x direction x outcome. The form mirrors
 * these rules for usability, but this function is the only source of
 * truth — never trust submitted values.
 *
 * note:    direction must be null; outcome must be null.
 * call:    direction required (outbound|inbound); outcome optional for
 *          either direction (an outbound call is synchronous — if it
 *          connected, the submitting staff member directly experienced
 *          the exchange; outcome=null on an outbound call represents "no
 *          confirmed exchange", e.g. no answer).
 * email:   direction required; outcome must be null when outbound (an
 *          async channel has no knowable outcome at send time — a reply
 *          is a separate inbound interaction); outcome optional when
 *          inbound.
 * meeting: direction must be null (bidirectional by nature); outcome
 *          optional (the attending staff member's assessment of how it
 *          went).
 */
function validateMatrix(type: InteractionType, direction: Direction | null, outcome: Outcome | null, locale: "fr" | "en"): void {
  const directionRequired = type === "call" || type === "email";
  if (directionRequired && direction === null) {
    throw new Error(MESSAGES[locale].invalidDirection);
  }
  if (!directionRequired && direction !== null) {
    throw new Error(MESSAGES[locale].invalidDirection);
  }

  if (type === "note" && outcome !== null) {
    throw new Error(MESSAGES[locale].invalidOutcome);
  }
  if (type === "email" && direction === "outbound" && outcome !== null) {
    throw new Error(MESSAGES[locale].invalidOutcome);
  }
}

export async function createInteraction(formData: FormData) {
  // RADAR-CORE-2A-A — human interaction writes are gated on Axis-C
  // (ACTIVE staff_members row in the internal workspace holding RADAR_WORK),
  // and the author is ALWAYS the authenticated session — never a
  // caller-supplied name, email, or id. The machine path
  // (lib/api-v1/interactions.ts) is separate and unchanged.
  await requireRadarAccess("RADAR_WORK");
  const { userId: actorUserId } = await requireSession();
  const locale = await getLocale();

  const clientId = formData.get("clientId");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error(MESSAGES[locale].clientRequired);
  }
  // P0-2H — RADAR_WORK (checked above) is a functional authorization
  // ("may work the radar"), not a tenant/client isolation check — every
  // OWNER/ADMIN/MANAGER/EMPLOYEE holds it. An EMPLOYEE may only log an
  // interaction against a client assigned to them; OWNER/ADMIN/MANAGER
  // (unrestricted scope) are unaffected. Same primitive already used by
  // createProject/createWebsite.
  await requireCrmClientAccess(clientId, new Error(MESSAGES[locale].clientNotFound));

  // 4F.8.4 — optional link to one of THIS client's deals (absent or blank =
  // general client interaction, deal_id NULL). Checked right after the client
  // scope gate above — an out-of-scope EMPLOYEE already got clientNotFound, so
  // the deal is never examined for them — and before every other rule. The
  // deal is only ever looked up together with this clientId, and a malformed
  // id, an unknown deal and another client's deal all throw the same
  // dealNotFound: no deal can be probed by id alone.
  const dealId = normalizeSelect(formData.get("dealId"));
  if (dealId !== null) {
    if (!isValidUuid(dealId)) throw new Error(MESSAGES[locale].dealNotFound);
    const [deal] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.clientId, clientId)))
      .limit(1);
    if (!deal) throw new Error(MESSAGES[locale].dealNotFound);
  }

  const summary = formData.get("summary");
  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error(MESSAGES[locale].summaryRequired);
  }

  // Explicit allowlist — previously any non-empty string was accepted
  // verbatim and a blank/missing type silently became "note". The
  // canonical write matrix can only be enforced safely against a known
  // set of types, so both a blank/missing type and an unrecognized one
  // are now rejected outright (no existing test or UI contract depended
  // on the old silent-default behavior — the form's own <select> always
  // submits an explicit value).
  const rawType = normalizeSelect(formData.get("type"));
  if (!rawType || !(TYPES as readonly string[]).includes(rawType)) {
    throw new Error(MESSAGES[locale].invalidType);
  }
  const type = rawType as InteractionType;

  const rawDirection = normalizeSelect(formData.get("direction"));
  if (rawDirection !== null && !(DIRECTIONS as readonly string[]).includes(rawDirection)) {
    throw new Error(MESSAGES[locale].invalidDirection);
  }
  const direction = rawDirection as Direction | null;

  const rawOutcome = normalizeSelect(formData.get("outcome"));
  if (rawOutcome !== null && !(OUTCOMES as readonly string[]).includes(rawOutcome)) {
    throw new Error(MESSAGES[locale].invalidOutcome);
  }
  const outcome = rawOutcome as Outcome | null;

  validateMatrix(type, direction, outcome, locale);

  // Fresh read immediately before insert — never trust any DNC value the
  // client might have cached/rendered earlier in the page lifecycle.
  const [client] = await db
    .select({ doNotContact: crmClients.doNotContact })
    .from(crmClients)
    .where(eq(crmClients.id, clientId))
    .limit(1);
  if (!client) throw new Error(MESSAGES[locale].clientNotFound);

  if (direction === "outbound" && client.doNotContact) {
    throw new Error(MESSAGES[locale].doNotContact);
  }

  const [interaction] = await db
    .insert(interactions)
    .values({
      clientId,
      dealId,
      type,
      summary: summary.trim(),
      direction,
      outcome,
      // Authoritative, session-derived author. `createdBy` (the legacy
      // free-text column) is deliberately left NULL for new human writes —
      // any caller-supplied "createdBy" / "createdByUserId" / "actorUserId"
      // FormData field is ignored.
      createdByUserId: actorUserId,
    })
    .returning();

  await logCrmAudit({
    action: "crm.interaction_logged",
    targetType: "interaction",
    targetId: interaction.id,
    clientId,
    // summary is kept (not dropped) — lib/audit-labels.ts's
    // describeAuditEntry() reads metadata.summary to render this entry's
    // activity-feed description; removing it would silently degrade that
    // existing display for every future interaction.
    metadata: {
      dealId: interaction.dealId,
      type: interaction.type,
      direction: interaction.direction,
      outcome: interaction.outcome,
      occurredAt: interaction.occurredAt,
      summary: interaction.summary,
    },
  });

  revalidatePath(`/admin/crm/clients/${clientId}`);
}
