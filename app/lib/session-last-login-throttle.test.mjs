// lib/session-last-login-throttle.test.mjs — PERF (SESSION): THROTTLE
// last_login_at WRITES — structural (source-text) proof of the exact
// ordering/gating guarantees the mission demands for lib/session.ts's
// resolveAccessState(), for the parts that cannot be exercised through a
// real HTTP request here.
//
// WHY SOURCE-TEXT, NOT A MOCKED CALL: resolveAccessState() calls Clerk's
// auth() unconditionally as its first statement. This codebase has an
// established, documented limitation (see lib/actions/user-approval.test.mjs's
// own header comment) — Node's --experimental-test-module-mocks does not
// reliably intercept @clerk/nextjs/server, so resolveAccessState() cannot
// be driven through a mocked Clerk session from a plain Node test. The
// live-write-count behavior (scenarios 1-4/9/11) is instead proven end to
// end against a real Clerk session in
// e2e/session-last-login-throttle.spec.ts; THIS file locks in the one
// guarantee that genuinely cannot be proven any other way without
// mutating the shared E2E account's `status` (the established risky
// pattern this mission's own audit flagged): that a refused/suspended
// account returns BEFORE the write is ever reached, in source order, not
// just "by convention."
//
// Run: npx tsx --test lib/session-last-login-throttle.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./session.ts", import.meta.url)), "utf8");

function resolveAccessStateBody() {
  const start = SOURCE.indexOf("const resolveAccessState = cache(async (): Promise<AccessState> => {");
  assert.ok(start >= 0, "could not locate resolveAccessState()");
  const end = SOURCE.indexOf("\n});", start);
  assert.ok(end > start, "could not locate the end of resolveAccessState()");
  return SOURCE.slice(start, end);
}

test("refused/suspended early-returns occur BEFORE the last_login_at UPDATE, in source order", () => {
  const body = resolveAccessStateBody();
  const refusedIdx = body.indexOf('appUser.status === "refused"');
  const suspendedIdx = body.indexOf('appUser.status === "suspended"');
  const updateIdx = body.indexOf("db.update(users).set({ lastLoginAt: new Date() })");

  assert.ok(refusedIdx >= 0, "refused check must exist");
  assert.ok(suspendedIdx >= 0, "suspended check must exist");
  assert.ok(updateIdx >= 0, "the last_login_at UPDATE must exist");

  assert.ok(refusedIdx < updateIdx, "refused must be checked (and returned from) BEFORE the UPDATE is ever reached");
  assert.ok(suspendedIdx < updateIdx, "suspended must be checked (and returned from) BEFORE the UPDATE is ever reached");
});

test("the last_login_at UPDATE is gated by isNewLoginSession -- never unconditional", () => {
  const body = resolveAccessStateBody();
  const gateIdx = body.indexOf("if (isNewLoginSession) {\n    await db.update(users).set({ lastLoginAt: new Date() })");
  assert.ok(gateIdx >= 0, "the UPDATE must be wrapped in `if (isNewLoginSession)`, not unconditional");
});

test("isNewLoginSession is computed exactly once and reused verbatim -- no second, independent time comparison introduced", () => {
  const body = resolveAccessStateBody();
  const occurrences = (body.match(/isNewLoginSession/g) || []).length;
  // 1 declaration + 1 doc-comment mention (the PERF rationale comment right
  // above the UPDATE) + 3 code usages (the UPDATE gate, the
  // WORKFORCE-branch product event gate, the CLIENT-branch product event
  // gate) = 5 total mentions.
  assert.equal(occurrences, 5, "isNewLoginSession must be declared once and reused by exactly the UPDATE gate + both login-event gates, not recomputed");

  // Only ONE real time-threshold comparison exists in the whole function --
  // the pre-existing formula this mission was told to reuse, never a second
  // one invented for the write gate specifically.
  const comparisons = (body.match(/LOGIN_EVENT_INACTIVITY_THRESHOLD_MS/g) || []).length;
  assert.equal(comparisons, 1, "no second time-comparison constant/logic was introduced for the write gate");
});

test("recordProductEvent('login') in both the WORKFORCE and CLIENT branches still uses the SAME isNewLoginSession gate as the write", () => {
  const body = resolveAccessStateBody();
  const workforceBranch = body.slice(body.indexOf("if (resolvedStaffMember) {"), body.indexOf("const resolvedMembership ="));
  const clientBranch = body.slice(body.indexOf("const resolvedMembership ="));

  assert.match(workforceBranch, /if \(isNewLoginSession\) \{\s*await recordProductEvent/, "WORKFORCE branch: login event still gated by isNewLoginSession");
  assert.match(clientBranch, /if \(isNewLoginSession\) \{\s*await recordProductEvent/, "CLIENT branch: login event still gated by isNewLoginSession");
});

test("previousLastLoginAt is still captured from appUser.lastLoginAt BEFORE any write, unchanged by this throttling change", () => {
  const body = resolveAccessStateBody();
  const captureIdx = body.indexOf("const previousLastLoginAt = appUser.lastLoginAt;");
  const updateIdx = body.indexOf("db.update(users).set({ lastLoginAt: new Date() })");
  assert.ok(captureIdx >= 0, "previousLastLoginAt capture must exist");
  assert.ok(captureIdx < updateIdx, "previousLastLoginAt must be captured strictly before the (now-conditional) write");
});

test("CurrentSession/AccessState public shapes are untouched by this change -- no new/removed field", () => {
  assert.match(SOURCE, /previousLastLoginAt: Date \| null;/);
  const occurrences = (SOURCE.match(/previousLastLoginAt: Date \| null;/g) || []).length;
  assert.equal(occurrences, 2, "exactly ClientSession + WorkforceSession, unchanged");
});
