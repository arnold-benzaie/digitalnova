// RADAR INTELLIGENCE PLATFORM V1 — Slice 1 — context sanitization security tests.
//
// Proves the sanitization boundary: a future intelligence provider can
// only ever receive the minimal, explicit business allowlist and NOTHING
// else — no Clerk id, session token, password, api key, DATABASE_URL,
// staff/role/workspace id, email, raw audit event, or UUID-shaped string.
//
// Run: npx tsx --test lib/radar-intelligence/sanitize-context.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeProspectContext,
  isSanitizedIntelligenceContext,
  findForbiddenKey,
  assertNoForbiddenKeys,
  redactUuids,
  FORBIDDEN_CONTEXT_KEY_PATTERNS,
} from "./sanitize-context.ts";

const ALLOWED_KEYS = [
  "prospectName",
  "company",
  "sector",
  "location",
  "stage",
  "deterministicPriority",
  "deterministicConfidence",
  "deterministicReasonCodes",
  "recommendedNextActionCode",
  "recentInteractionSummaries",
  "openFollowUpCount",
  "nextFollowUpDueOn",
].sort();

// A hostile input: a whole CRM row + a session + secrets, mixed with the
// legitimate fields. NOTHING outside the allowlist may survive.
const HOSTILE = {
  // legitimate
  prospectName: "Garage Moreau Auto",
  company: "Moreau SAS",
  sector: "automotive",
  location: "Marseille, FR",
  stage: "prospect",
  deterministicPriority: "HIGH",
  deterministicConfidence: "LOW",
  deterministicReasonCodes: ["DEAL_STAGE_QUALIFIED"],
  recommendedNextActionCode: "REVIEW_DEAL",
  recentInteractionSummaries: [
    "Spoke with owner 04f0b05e-d918-4031-8f3a-b9d6c90354c4 re: contract",
    "  ",
    12345,
    "x".repeat(5000),
  ],
  openFollowUpCount: 2,
  nextFollowUpDueOn: "2026-10-01T09:00:00.000Z",
  // forbidden — must all be dropped by omission
  clerkUserId: "user_3GxkkOOoLPNSZLmXdcOrZRAniC8",
  sessionToken: "sess_deadbeef",
  session: { token: "abc" },
  password: "hunter2",
  apiKey: "sk_live_zzz",
  api_key: "sk_live_yyy",
  DATABASE_URL: "postgresql://u:p@h:5432/db",
  databaseUrl: "postgresql://u:p@h:5432/db",
  authorization: "Bearer xxx",
  userId: "32371e8f-0000-0000-0000-000000000000",
  staffMemberId: "6a615714-4eb7-44f3-993b-f113292f0aa2",
  roleId: "abc",
  workspaceOrgId: "org_123",
  email: "arnoldbenzaie@gmail.com",
  phone: "+33123456789",
  auditEvents: [{ action: "owner.admin_demoted" }],
  rbac: { permissions: ["OWNER_MANAGE"] },
  rawClientRow: { id: "deadbeef-dead-4bee-8fee-deadbeefcafe", ownerName: "secret" },
};

test("sanitize: result has EXACTLY the allowlist keys — nothing more", () => {
  const ctx = sanitizeProspectContext(HOSTILE);
  assert.deepEqual(Object.keys(ctx).sort(), ALLOWED_KEYS);
});

test("sanitize: NO forbidden key appears anywhere in the sanitized object", () => {
  const ctx = sanitizeProspectContext(HOSTILE);
  assert.equal(findForbiddenKey(ctx), null);
  assert.doesNotThrow(() => assertNoForbiddenKeys(ctx));
});

test("sanitize: NO forbidden VALUE survives (serialize and scan)", () => {
  const ctx = sanitizeProspectContext(HOSTILE);
  const json = JSON.stringify(ctx);
  for (const needle of [
    "user_3GxkkOOoLPNSZLmXdcOrZRAniC8",
    "sess_deadbeef",
    "hunter2",
    "sk_live_zzz",
    "sk_live_yyy",
    "postgresql://",
    "Bearer xxx",
    "32371e8f-0000-0000-0000-000000000000",
    "6a615714-4eb7-44f3-993b-f113292f0aa2",
    "arnoldbenzaie@gmail.com",
    "+33123456789",
    "owner.admin_demoted",
    "OWNER_MANAGE",
    "ownerName",
  ]) {
    assert.equal(json.includes(needle), false, `forbidden value leaked: ${needle}`);
  }
});

test("sanitize: UUID-shaped strings are redacted from free-text summaries", () => {
  const ctx = sanitizeProspectContext(HOSTILE);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(JSON.stringify(ctx)), false);
  assert.match(ctx.recentInteractionSummaries[0], /Spoke with owner \[id\] re: contract/);
});

test("sanitize: summaries are capped in count and length; non-strings dropped", () => {
  const ctx = sanitizeProspectContext(HOSTILE);
  assert.ok(ctx.recentInteractionSummaries.length <= 5);
  for (const s of ctx.recentInteractionSummaries) assert.ok(s.length <= 280);
  assert.equal(
    ctx.recentInteractionSummaries.some((s) => s.trim() === "" || s === "12345"),
    false,
  );
});

test("sanitize: enum fields fall back safely on garbage", () => {
  const ctx = sanitizeProspectContext({ prospectName: "X", stage: "s", deterministicPriority: "WAT", deterministicConfidence: 7 });
  assert.equal(ctx.deterministicPriority, "LOW");
  assert.equal(ctx.deterministicConfidence, "LOW");
  assert.equal(ctx.openFollowUpCount, 0);
  assert.equal(ctx.nextFollowUpDueOn, null);
});

test("sanitize: dueOn is reduced to a date (no time-of-day)", () => {
  const ctx = sanitizeProspectContext({ prospectName: "X", stage: "s", nextFollowUpDueOn: "2026-10-01T09:34:56.789Z" });
  assert.equal(ctx.nextFollowUpDueOn, "2026-10-01");
});

test("sanitize: output is branded and only this function can mint it", () => {
  const ctx = sanitizeProspectContext({ prospectName: "X", stage: "s" });
  assert.equal(isSanitizedIntelligenceContext(ctx), true);
  assert.equal(isSanitizedIntelligenceContext({ ...ctx }), false, "a plain spread copy loses the non-enumerable brand");
  assert.equal(isSanitizedIntelligenceContext({ prospectName: "X" }), false);
  const desc = Object.getOwnPropertyDescriptor(ctx, "__sanitized");
  assert.equal(desc.enumerable, false);
  assert.equal(desc.writable, false);
});

test("findForbiddenKey: detects a forbidden key at any depth and names the PATH (not a value)", () => {
  assert.equal(findForbiddenKey({ a: { b: { sessionToken: "x" } } }), "a.b.sessionToken");
  assert.equal(findForbiddenKey({ list: [{ ok: 1 }, { apiKey: "x" }] }), "list[1].apiKey");
  assert.equal(findForbiddenKey({ safe: 1, nested: { alsoSafe: 2 } }), null);
  assert.throws(() => assertNoForbiddenKeys({ clerkUserId: "x" }), /forbidden key: clerkUserId/);
});

test("FORBIDDEN_CONTEXT_KEY_PATTERNS covers the key families the mission enumerates", () => {
  const mustMatch = [
    "clerkUserId",
    "sessionToken",
    "password",
    "apiKey",
    "api_key",
    "DATABASE_URL",
    "authorization",
    "userId",
    "staffMemberId",
    "roleId",
    "workspaceOrgId",
    "email",
    "auditEvent",
    "rbac",
    "permissions",
  ];
  for (const k of mustMatch) {
    assert.ok(
      FORBIDDEN_CONTEXT_KEY_PATTERNS.some((re) => re.test(k)),
      `no forbidden pattern matches "${k}"`,
    );
  }
  // legitimate allowlist keys must NOT be flagged
  for (const k of ["prospectName", "company", "sector", "location", "stage", "openFollowUpCount", "nextFollowUpDueOn"]) {
    assert.equal(
      FORBIDDEN_CONTEXT_KEY_PATTERNS.some((re) => re.test(k)),
      false,
      `allowlist key "${k}" is wrongly flagged forbidden`,
    );
  }
});

test("redactUuids leaves ordinary text intact", () => {
  assert.equal(redactUuids("no ids here"), "no ids here");
  assert.equal(redactUuids("a 11111111-2222-4333-8444-555555555555 b"), "a [id] b");
});
