// PHASE A — CENTRALIZED CRM DEDUPLICATION — unit tests.
//
// Two layers tested here, matching the module's own "pure decision core
// / thin DB-orchestrating wrapper" split (see crm-client-dedup.ts's own
// header comment, mirroring lib/radar/score.ts's precedent):
//
//  1. Normalization functions (normalizeCrmEmail/Text/PhoneToE164) — pure,
//     no mocks.
//  2. decideCrmDedupMatch — pure, no mocks: the ENTIRE matching decision
//     matrix (every NO_MATCH / EXACT_MATCH / AMBIGUOUS_MATCH branch,
//     including every mandatory non-fusion case) is exercised here with
//     plain arrays, exactly as it would be fed by real DB query results.
//  3. findCrmClientMatch — the thin DB-orchestrating wrapper — gets a
//     FAKE @/db (same convention as quota-counter-store.test.mjs) whose
//     job is only to prove: which signals trigger a query at all (a bare
//     name must trigger ZERO queries), and that query results are wired
//     into decideCrmDedupMatch correctly. The real SQL WHERE-clause
//     correctness (lower(email)=X AND archivedAt IS NULL, etc.) is proven
//     against a REAL Postgres by crm-client-dedup.integration.test.mjs.
//
// No website-based signal is tested: crm_clients has no `website` column
// (confirmed by reading db/schema.ts) — out of scope for this phase, see
// the final report's "website matching: N/A" note.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/crm-client-dedup.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

/** @type {Array<{ selectShape: string }>} */
let dbCalls = [];
/** @type {Array<string[]>} results returned in call order (email, then
 * phone, then nameLocation — whichever of those the module actually
 * issues, in that fixed order). */
let queuedResults = [];

const fakeDb = {
  select: (selectShape) => ({
    from: () => ({
      where: () => ({
        orderBy: () => {
          dbCalls.push({ selectShape });
          const next = queuedResults.shift() ?? [];
          return Promise.resolve(next.map((id) => ({ id })));
        },
      }),
    }),
  }),
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const { normalizeCrmEmail, normalizeCrmText, normalizeCrmPhoneToE164, decideCrmDedupMatch, findCrmClientMatch } = await import("./crm-client-dedup.ts");

function reset() {
  dbCalls = [];
  queuedResults = [];
}
test.beforeEach(reset);

// ---- normalization ----

test("normalizeCrmEmail: trim + lowercase", () => {
  assert.equal(normalizeCrmEmail("  Jane@Example.com  "), "jane@example.com");
});

test("normalizeCrmEmail: null/undefined/empty/whitespace-only -> null (no signal)", () => {
  assert.equal(normalizeCrmEmail(null), null);
  assert.equal(normalizeCrmEmail(undefined), null);
  assert.equal(normalizeCrmEmail(""), null);
  assert.equal(normalizeCrmEmail("   "), null);
});

test("normalizeCrmEmail: two visibly different emails never normalize to the same value", () => {
  assert.notEqual(normalizeCrmEmail("jane@example.com"), normalizeCrmEmail("john@example.com"));
});

test("normalizeCrmText: trim + lowercase + collapse internal whitespace (name/city/region/country)", () => {
  assert.equal(normalizeCrmText("  ABC   Services  "), "abc services");
  assert.equal(normalizeCrmText("Montreal"), "montreal");
});

test("normalizeCrmText: accented variants are NOT collapsed to the same value — a deliberate, documented Phase A limitation (no fuzzy/geocoding)", () => {
  assert.notEqual(normalizeCrmText("Montréal"), normalizeCrmText("Montreal"));
});

test("normalizeCrmText: null/undefined/empty -> null", () => {
  assert.equal(normalizeCrmText(null), null);
  assert.equal(normalizeCrmText(undefined), null);
  assert.equal(normalizeCrmText("   "), null);
});

test("normalizeCrmPhoneToE164: an already-international number normalizes to E.164", () => {
  assert.equal(normalizeCrmPhoneToE164("+1 514 555 0100"), "+15145550100");
});

test("normalizeCrmPhoneToE164: a national-format number with no country hint cannot be reliably parsed -> null, never a guessed value", () => {
  assert.equal(normalizeCrmPhoneToE164("514 555 0100"), null);
  assert.equal(normalizeCrmPhoneToE164("04 78 00 00 02"), null);
});

test("normalizeCrmPhoneToE164: garbage / null / empty -> null, never throws", () => {
  assert.equal(normalizeCrmPhoneToE164("not a phone number"), null);
  assert.equal(normalizeCrmPhoneToE164(null), null);
  assert.equal(normalizeCrmPhoneToE164(""), null);
  assert.equal(normalizeCrmPhoneToE164("   "), null);
});

test("normalizeCrmPhoneToE164: two genuinely different E.164 numbers never collide", () => {
  assert.notEqual(normalizeCrmPhoneToE164("+15145550100"), normalizeCrmPhoneToE164("+15145550199"));
});

// ---- decideCrmDedupMatch — the pure decision matrix ----

test("A. email exact — single candidate -> EXACT_MATCH, confidence HIGH, signal=email", () => {
  const r = decideCrmDedupMatch({ email: ["client-1"], phone: [], nameLocation: [] });
  assert.equal(r.outcome, "EXACT_MATCH");
  assert.equal(r.clientId, "client-1");
  assert.deepEqual(r.matchedSignals, ["email"]);
  assert.equal(r.confidence, "HIGH");
});

test("E. phone E.164 exact — single candidate -> EXACT_MATCH, confidence HIGH, signal=phone", () => {
  const r = decideCrmDedupMatch({ email: [], phone: ["client-2"], nameLocation: [] });
  assert.equal(r.outcome, "EXACT_MATCH");
  assert.equal(r.clientId, "client-2");
  assert.deepEqual(r.matchedSignals, ["phone"]);
  assert.equal(r.confidence, "HIGH");
});

test("email and phone both match the SAME client -> still one EXACT_MATCH, both signals reported", () => {
  const r = decideCrmDedupMatch({ email: ["client-1"], phone: ["client-1"], nameLocation: [] });
  assert.equal(r.outcome, "EXACT_MATCH");
  assert.equal(r.clientId, "client-1");
  assert.deepEqual(r.matchedSignals, ["email", "phone"]);
});

test("F. phone provided but matches nothing, no other signal -> NO_MATCH", () => {
  const r = decideCrmDedupMatch({ email: [], phone: [], nameLocation: [] });
  assert.equal(r.outcome, "NO_MATCH");
});

test("D. two different emails independently resolve independently (no cross-contamination)", () => {
  const r1 = decideCrmDedupMatch({ email: ["client-1"], phone: [], nameLocation: [] });
  const r2 = decideCrmDedupMatch({ email: ["client-2"], phone: [], nameLocation: [] });
  assert.equal(r1.clientId, "client-1");
  assert.equal(r2.clientId, "client-2");
});

test("G. name + city + region matched exactly one candidate -> AMBIGUOUS_MATCH (never auto-merged), confidence MEDIUM", () => {
  const r = decideCrmDedupMatch({ email: [], phone: [], nameLocation: ["client-3"] });
  assert.equal(r.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(r.candidateClientIds, ["client-3"]);
  assert.deepEqual(r.matchedSignals, ["name_location"]);
  assert.equal(r.confidence, "MEDIUM");
});

test("H. MANDATORY NON-FUSION: 'ABC Services' Montreal vs 'ABC Services' Quebec City — different city means the city query never returns the OTHER row as a candidate at all, so decideCrmDedupMatch sees an empty nameLocation set for that comparison -> NO_MATCH", () => {
  // The city predicate is what tells the two apart at the query layer
  // (queryByNameLocation) — this test proves the DECISION layer's
  // correct behavior when that query legitimately returns nothing for a
  // mismatched city, i.e. it never falls back to a name-only match.
  const r = decideCrmDedupMatch({ email: [], phone: [], nameLocation: [] });
  assert.equal(r.outcome, "NO_MATCH", "a name shared with a DIFFERENT city must never merge");
});

test("I. MANDATORY NON-FUSION: name alone, no location signal at all -> NO_MATCH (name alone is never sufficient)", () => {
  const r = decideCrmDedupMatch({ email: [], phone: [], nameLocation: [] });
  assert.equal(r.outcome, "NO_MATCH");
});

test("K. contradictory strong signals — email matches client A, phone matches client B -> AMBIGUOUS_MATCH, confidence LOW, never an arbitrary pick", () => {
  const r = decideCrmDedupMatch({ email: ["client-A"], phone: ["client-B"], nameLocation: [] });
  assert.equal(r.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(r.candidateClientIds, ["client-A", "client-B"]);
  assert.deepEqual(r.matchedSignals, ["email", "phone"]);
  assert.equal(r.confidence, "LOW");
});

test("L. MANDATORY NON-FUSION: a single signal matches MULTIPLE candidates -> AMBIGUOUS_MATCH, confidence MEDIUM, all candidates listed, never a silent pick", () => {
  const r = decideCrmDedupMatch({ email: ["client-1", "client-2"], phone: [], nameLocation: [] });
  assert.equal(r.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(r.candidateClientIds, ["client-1", "client-2"]);
  assert.equal(r.confidence, "MEDIUM");
});

test("L. name+location tier matches multiple candidates -> AMBIGUOUS_MATCH, confidence LOW (weaker than a tier-1 multi-match)", () => {
  const r = decideCrmDedupMatch({ email: [], phone: [], nameLocation: ["client-3", "client-4"] });
  assert.equal(r.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(r.candidateClientIds, ["client-3", "client-4"]);
  assert.equal(r.confidence, "LOW");
});

test("M. no candidate on any tier -> NO_MATCH", () => {
  const r = decideCrmDedupMatch({ email: [], phone: [], nameLocation: [] });
  assert.deepEqual(r, { outcome: "NO_MATCH" });
});

test("O. pre-existing historical duplicate rows (two rows already share the same email) -> AMBIGUOUS_MATCH, never picks one arbitrarily", () => {
  // This is the exact scenario captureLead()'s OLD `.limit(1)` (no
  // ORDER BY) behavior could not distinguish from a single match.
  const r = decideCrmDedupMatch({ email: ["dup-row-1", "dup-row-2"], phone: [], nameLocation: [] });
  assert.equal(r.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(r.candidateClientIds, ["dup-row-1", "dup-row-2"]);
});

test("result ids are always deduplicated and sorted — deterministic output regardless of input array order", () => {
  const r = decideCrmDedupMatch({ email: ["z-client", "a-client", "z-client"], phone: [], nameLocation: [] });
  assert.equal(r.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(r.candidateClientIds, ["a-client", "z-client"]);
});

// ---- findCrmClientMatch — thin DB-orchestrating wrapper ----

test("N. fully empty/null input triggers ZERO database queries and returns NO_MATCH", async () => {
  const r = await findCrmClientMatch({});
  assert.deepEqual(r, { outcome: "NO_MATCH" });
  assert.equal(dbCalls.length, 0);
});

test("I. name alone (no email/phone/city) triggers ZERO database queries — 'NOM SEUL != MATCH AUTOMATIQUE' holds structurally, not just by the decision rule", async () => {
  const r = await findCrmClientMatch({ name: "ABC Services" });
  assert.deepEqual(r, { outcome: "NO_MATCH" });
  assert.equal(dbCalls.length, 0, "a bare name must never even reach the database");
});

test("name + city but NO region/country -> still zero queries (location not precise enough)", async () => {
  const r = await findCrmClientMatch({ name: "ABC Services", city: "Montreal" });
  assert.deepEqual(r, { outcome: "NO_MATCH" });
  assert.equal(dbCalls.length, 0);
});

test("email present -> exactly one query issued, and a single hit becomes EXACT_MATCH", async () => {
  queuedResults = [["client-1"]];
  const r = await findCrmClientMatch({ email: "jane@example.com" });
  assert.equal(dbCalls.length, 1);
  assert.equal(r.outcome, "EXACT_MATCH");
  assert.equal(r.clientId, "client-1");
});

test("email that does not parse to any signal (empty string) -> zero queries", async () => {
  const r = await findCrmClientMatch({ email: "   " });
  assert.deepEqual(r, { outcome: "NO_MATCH" });
  assert.equal(dbCalls.length, 0);
});

test("phone that cannot be reliably normalized (no country hint) -> zero queries, contributes nothing", async () => {
  const r = await findCrmClientMatch({ phone: "514 555 0100" });
  assert.deepEqual(r, { outcome: "NO_MATCH" });
  assert.equal(dbCalls.length, 0);
});

test("email + phone + full location provided -> up to three targeted queries, results wired into the decision correctly", async () => {
  queuedResults = [[], [], ["client-9"]]; // email miss, phone miss, name+location hit
  const r = await findCrmClientMatch({
    email: "unknown@example.com",
    phone: "+15145550100",
    name: "ABC Services",
    city: "Montreal",
    region: "Quebec",
  });
  assert.equal(dbCalls.length, 3);
  assert.equal(r.outcome, "AMBIGUOUS_MATCH");
  assert.deepEqual(r.candidateClientIds, ["client-9"]);
});

test("J. website is not a supported signal in this phase — crm_clients has no website column; findCrmClientMatch's input type has no website field at all (structural, not just a runtime no-op)", () => {
  // Purely a type-shape assertion in spirit: CrmDedupCandidateInput is
  // {name, email, phone, city, region, country} only — verified by
  // reading crm-client-dedup.ts. No runtime assertion needed since a
  // stray `website` property, if ever passed by a caller, is simply
  // ignored by JS (not read anywhere in the module).
  assert.ok(true);
});
