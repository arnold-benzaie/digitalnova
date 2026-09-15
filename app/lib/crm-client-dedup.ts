/**
 * PHASE A — CENTRALIZED CRM DEDUPLICATION
 *
 * The single, server-side source of truth for "does a new prospect/client
 * record probably already exist in crm_clients" — reused by every
 * crm_clients creation path (lib/actions/crm-clients.ts::createClient,
 * lib/chat/leads.ts::captureLead, lib/actions/crm-invoices.ts's
 * resolveInvoiceClient, lib/actions/crm-tickets.ts::createTicket) instead
 * of each hand-rolling its own narrow, single-field exact-match check.
 *
 * Replaces the two pre-existing ad hoc checks this phase was commissioned
 * to fix:
 *  - lib/chat/leads.ts::captureLead's `lower(email) = :email` (kept as a
 *    signal here, but no longer silently picks an arbitrary row via
 *    `.limit(1)` with no ORDER BY when more than one existing row shares
 *    that email).
 *  - lib/actions/crm-invoices.ts::resolveInvoiceClient's
 *    `lower(name) = lower(name)` with NO other predicate — a confirmed,
 *    real (not theoretical) false-positive risk: two unrelated businesses
 *    sharing a name in different cities would silently merge. This module
 *    NEVER treats a bare name as sufficient evidence of identity.
 *
 * DESIGN — three signal tiers, deliberately asymmetric in trust:
 *
 *  TIER 1 (strong identity signals, each alone sufficient for
 *  EXACT_MATCH when exactly one existing client matches):
 *   - normalized email (trim + lowercase), exact match, non-archived rows
 *     only.
 *   - normalized phone (E.164 via libphonenumber-js, only when it can be
 *     derived RELIABLY — see normalizeCrmPhoneToE164's own docstring),
 *     exact match, non-archived rows only.
 *  If a tier-1 signal matches MORE than one existing client (a
 *  pre-existing duplicate already in the data), or if two tier-1 signals
 *  point at two DIFFERENT existing clients (a contradiction), the result
 *  is AMBIGUOUS_MATCH — never an arbitrary pick.
 *
 *  TIER 2 (corroborating signal, NEVER sufficient alone for an automatic
 *  merge): normalized name + normalized city + (normalized region OR
 *  normalized country) — all present and all matching. This is the exact
 *  mechanism that fixes the "ABC Services, Montreal" vs "ABC Services,
 *  Quebec City" case: two rows with the identical normalized name but a
 *  different city can never match each other under this rule (the city
 *  predicate alone tells them apart), and a bare name with no location at
 *  all never reaches this tier — see findCrmClientMatch's own docstring.
 *  Even a full tier-2 match on exactly one candidate is only ever reported
 *  as AMBIGUOUS_MATCH (confidence MEDIUM), never EXACT_MATCH — this phase
 *  deliberately does not build fuzzy/geocoded address matching (see
 *  mission scope), so an exact string match on free-text city/region/
 *  country fields is a reasonable but not provably sufficient basis for an
 *  automatic, silent merge; it is surfaced for a human decision instead.
 *
 *  NO MATCH: nothing on any tier -> NO_MATCH.
 *
 * Confidence is reported using the SAME closed three-value enum RADAR
 * already established (lib/radar/score.ts::Confidence, "LOW"|"MEDIUM"|
 * "HIGH") — deliberately not a numeric/arbitrary score, matching that
 * existing codebase precedent.
 *
 * Server-side only, deterministic, independent of RADAR/AI/any external
 * provider — this phase builds none of those. No new table, no new
 * column, no schema change of any kind.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { crmClients } from "@/db/schema";
import { parsePhoneNumberFromString } from "libphonenumber-js/core";
// Same "core" build + explicit metadata import as lib/chat/validation.ts /
// lib/chat/leads.ts — see either file's own comment: the top-level
// `libphonenumber-js` package triggers a tsx/Node ESM-CJS interop bug
// under this project's test runner.
import metadata from "libphonenumber-js/metadata.min.json";

// ---------------------------------------------------------------------
// Normalization — deterministic, conservative. None of these attempt
// fuzzy matching, accent stripping, or geocoding: an accented or
// differently-spelled variant of the same value will NOT be recognized
// as equal (a false negative — the safe direction, never a false
// positive). This is a deliberate Phase A scope boundary, not an
// oversight — see this file's own header.
// ---------------------------------------------------------------------

/** trim + lowercase; "" (after trim) and non-string input both normalize
 * to `null` ("no signal"), never to an empty-string match key. */
export function normalizeCrmEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/** trim + lowercase + collapse internal whitespace runs to a single
 * space. Used for name/city/region/country alike — the same
 * conservative treatment, since none of these are validated against any
 * canonical taxonomy (no ISO country codes, no city gazetteer) in this
 * schema today. */
export function normalizeCrmText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.trim().toLowerCase().replace(/\s+/g, " ");
  return collapsed === "" ? null : collapsed;
}

/**
 * Derives an E.164 phone representation ONLY when libphonenumber-js can
 * parse and validate the input WITHOUT a default-country hint — i.e. only
 * for a number already given in (or unambiguously convertible to)
 * international "+<countrycode>..." form. crm_clients.country is free
 * text, not an ISO-3166 code, so it is deliberately never used as a
 * parsing hint here: guessing a country would risk normalizing two
 * genuinely different numbers into a false match. A number that cannot be
 * reliably parsed this way normalizes to `null` (no signal) rather than
 * falling back to a raw-string comparison, which would silently miss
 * differently-formatted-but-identical numbers (a false negative — safe)
 * while never risking a false positive.
 */
export function normalizeCrmPhoneToE164(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let parsed;
  try {
    parsed = parsePhoneNumberFromString(trimmed, metadata);
  } catch {
    return null;
  }
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

function dedupeIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).sort();
}

// ---------------------------------------------------------------------
// Matching decision — PURE, no I/O. Given which existing client ids each
// signal already matched (computed by findCrmClientMatch below via
// targeted DB queries), decides the outcome. Kept separate from the DB
// orchestration specifically so the entire decision matrix — including
// every "must never auto-merge" case this phase exists to guarantee — is
// unit-testable without a database, mirroring lib/radar/score.ts's own
// "pure decision function, thin DB-orchestrating caller" split.
// ---------------------------------------------------------------------

export type CrmDedupSignal = "email" | "phone" | "name_location";
export type CrmDedupConfidence = "LOW" | "MEDIUM" | "HIGH";

export type CrmDedupResult =
  | { outcome: "NO_MATCH" }
  | {
      outcome: "EXACT_MATCH";
      clientId: string;
      matchedSignals: CrmDedupSignal[];
      confidence: "HIGH";
      reason: string;
    }
  | {
      outcome: "AMBIGUOUS_MATCH";
      candidateClientIds: string[];
      matchedSignals: CrmDedupSignal[];
      confidence: CrmDedupConfidence;
      reason: string;
    };

export type CrmDedupSignalMatches = {
  /** Distinct existing client ids whose normalized email matched — empty
   * when no email signal was present (never queried), not just "no hit". */
  email: readonly string[];
  phone: readonly string[];
  /** Tier-2 candidates: name + precise location — see this file's header. */
  nameLocation: readonly string[];
};

/**
 * Pure decision core. `matches` reflects EXACTLY which signals were even
 * evaluated (an empty array for a signal that was never queried at all —
 * e.g. no email provided — is indistinguishable here from "queried, zero
 * hits", which is the correct behavior: both mean that signal contributes
 * nothing).
 */
export function decideCrmDedupMatch(matches: CrmDedupSignalMatches): CrmDedupResult {
  const tier1: Array<{ signal: "email" | "phone"; ids: string[] }> = [];
  if (matches.email.length > 0) tier1.push({ signal: "email", ids: dedupeIds(matches.email) });
  if (matches.phone.length > 0) tier1.push({ signal: "phone", ids: dedupeIds(matches.phone) });

  if (tier1.length > 0) {
    const matchedSignals = tier1.map((s) => s.signal);
    // A single tier-1 signal already matching MORE than one existing
    // client means a duplicate already exists in the data itself — never
    // resolved by picking one arbitrarily (the exact bug this phase
    // fixes in lib/chat/leads.ts's old `.limit(1)`-with-no-ORDER-BY
    // behavior).
    const anySignalAmbiguous = tier1.some((s) => s.ids.length > 1);
    const distinctIdsAcrossSignals = dedupeIds(tier1.flatMap((s) => s.ids));

    if (anySignalAmbiguous) {
      return {
        outcome: "AMBIGUOUS_MATCH",
        candidateClientIds: distinctIdsAcrossSignals,
        matchedSignals,
        confidence: "MEDIUM",
        reason: "a strong signal (email or phone) matched more than one existing client — a pre-existing duplicate, never resolved arbitrarily",
      };
    }
    if (distinctIdsAcrossSignals.length > 1) {
      // Two tier-1 signals each unambiguously matched exactly one
      // client, but a DIFFERENT one from each other.
      return {
        outcome: "AMBIGUOUS_MATCH",
        candidateClientIds: distinctIdsAcrossSignals,
        matchedSignals,
        confidence: "LOW",
        reason: "contradictory strong signals — email and phone point to two different existing clients",
      };
    }
    return {
      outcome: "EXACT_MATCH",
      clientId: distinctIdsAcrossSignals[0],
      matchedSignals,
      confidence: "HIGH",
      reason: `unambiguous match on ${matchedSignals.join(" and ")}`,
    };
  }

  const nameLocationIds = dedupeIds(matches.nameLocation);
  if (nameLocationIds.length > 0) {
    return {
      outcome: "AMBIGUOUS_MATCH",
      candidateClientIds: nameLocationIds,
      matchedSignals: ["name_location"],
      confidence: nameLocationIds.length === 1 ? "MEDIUM" : "LOW",
      reason:
        nameLocationIds.length === 1
          ? "name + precise location matched exactly one existing client — a corroborating signal only, never sufficient by itself for an automatic merge"
          : "name + precise location matched more than one existing client",
    };
  }

  return { outcome: "NO_MATCH" };
}

// ---------------------------------------------------------------------
// DB orchestration — thin. Normalizes input, runs only the targeted
// queries each present signal actually needs (a bare name with no city
// never triggers ANY query — "NOM SEUL != MATCH AUTOMATIQUE" holds
// structurally, not just by the decision rule above), and hands the
// results to decideCrmDedupMatch. All queries exclude archived rows,
// mirroring captureLead's own pre-existing convention.
// ---------------------------------------------------------------------

export type CrmDedupCandidateInput = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
};

async function queryByEmail(normalizedEmail: string): Promise<string[]> {
  const rows = await db
    .select({ id: crmClients.id })
    .from(crmClients)
    .where(and(sql`lower(${crmClients.email}) = ${normalizedEmail}`, isNull(crmClients.archivedAt)))
    .orderBy(crmClients.createdAt, crmClients.id);
  return rows.map((r) => r.id);
}

async function queryByPhone(normalizedPhone: string): Promise<string[]> {
  // Direct equality against the E.164 string — see
  // normalizeCrmPhoneToE164's docstring: this only matches an existing
  // row whose OWN stored `phone` value is already in that exact form
  // (true today for every row captureLead() created). A same number
  // stored in a different format will not match at this layer — a
  // documented false negative (safe direction), not a false positive.
  const rows = await db
    .select({ id: crmClients.id })
    .from(crmClients)
    .where(and(eq(crmClients.phone, normalizedPhone), isNull(crmClients.archivedAt)))
    .orderBy(crmClients.createdAt, crmClients.id);
  return rows.map((r) => r.id);
}

async function queryByNameLocation(name: string, city: string, region: string | null, country: string | null): Promise<string[]> {
  const conditions = [sql`lower(${crmClients.name}) = ${name}`, sql`lower(${crmClients.city}) = ${city}`, isNull(crmClients.archivedAt)];
  if (region) conditions.push(sql`lower(${crmClients.region}) = ${region}`);
  if (country) conditions.push(sql`lower(${crmClients.country}) = ${country}`);
  const rows = await db
    .select({ id: crmClients.id })
    .from(crmClients)
    .where(and(...conditions))
    .orderBy(crmClients.createdAt, crmClients.id);
  return rows.map((r) => r.id);
}

/**
 * The single entry point every crm_clients creation path should call
 * before inserting a new row. Never mutates anything — a pure read
 * followed by a pure decision.
 */
export async function findCrmClientMatch(input: CrmDedupCandidateInput): Promise<CrmDedupResult> {
  const normalizedEmail = normalizeCrmEmail(input.email);
  const normalizedPhone = normalizeCrmPhoneToE164(input.phone);
  const normalizedName = normalizeCrmText(input.name);
  const normalizedCity = normalizeCrmText(input.city);
  const normalizedRegion = normalizeCrmText(input.region);
  const normalizedCountry = normalizeCrmText(input.country);

  const email = normalizedEmail ? await queryByEmail(normalizedEmail) : [];
  const phone = normalizedPhone ? await queryByPhone(normalizedPhone) : [];
  // Tier 2 requires a name AND a city AND at least one of region/country
  // — a bare name, or name+country-only (too coarse), never queries.
  const nameLocation =
    normalizedName && normalizedCity && (normalizedRegion || normalizedCountry)
      ? await queryByNameLocation(normalizedName, normalizedCity, normalizedRegion, normalizedCountry)
      : [];

  return decideCrmDedupMatch({ email, phone, nameLocation });
}
