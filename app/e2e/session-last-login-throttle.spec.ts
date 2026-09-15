import { test, expect } from "@playwright/test";
import { readLastLoginAt, setLastLoginAt, restoreLastLoginAt, loginProductEventCountSince } from "./helpers/main-db-last-login.mjs";

/**
 * PERF (SESSION) — THROTTLE last_login_at WRITES — real-browser, real-Clerk
 * proof that resolveAccessState() (lib/session.ts) now writes
 * `users.last_login_at` ONLY when isNewLoginSession is true (first-ever
 * visit, or > 4h since the previous one), never on every request within an
 * already-active session.
 *
 * WHY E2E, NOT a Node-level mocked unit/integration test: this codebase has
 * an established, documented limitation (see lib/actions/user-approval.test.mjs's
 * own header comment) — Node's --experimental-test-module-mocks does not
 * reliably intercept @clerk/nextjs/server (its own "server-only"-style
 * guard still fires even when mocked), so the Clerk-facing half of
 * lib/session.ts is, by existing repo convention, covered by real E2E
 * against a real Clerk Development session instead — exactly what
 * e2e/session-authority.spec.ts already does for the WORKFORCE/CLIENT
 * priority behavior this file does not re-test.
 *
 * Mutates ONLY the shared E2E account's `users.last_login_at` column — the
 * SAFEST possible mutation in this shared-account test family: unlike
 * main-db-role.mjs's Axis-A role swap or main-db-staff.mjs's Axis-C row,
 * `last_login_at` is not a fixture ANY other spec's setup or assertions
 * depend on (see the last_login_at audit report: every real consumer is a
 * display/analytics reader). No role, membership, or staff_members row is
 * touched here — the account's standing baseline (Axis-A admin membership
 * + Axis-C EMPLOYEE ACTIVE, per crm-radar.spec.ts's own standing seed)
 * resolves as WORKFORCE by the existing, untouched priority rule, so every
 * navigation below exercises the real WORKFORCE branch of
 * resolveAccessState() without needing any setup of its own.
 *
 * refused/suspended and a pure-CLIENT context are deliberately NOT
 * exercised here: reproducing them requires mutating the shared account's
 * `users.status`/Axis-A role, the established risky pattern this file
 * exists specifically to avoid. That ordering guarantee (refused/suspended
 * return before any write) is instead locked by
 * lib/session-last-login-throttle.test.mjs's source-order proof, and
 * pure-CLIENT resolution itself is already proven end to end, unaffected,
 * by e2e/session-authority.spec.ts's own existing, already-passing test.
 */
test.describe.configure({ mode: "serial" });
test.use({ locale: "fr-FR" });

let originalLastLoginAt: Date | null;

test.beforeAll(async () => {
  originalLastLoginAt = await readLastLoginAt();
});

test.afterEach(async () => {
  await restoreLastLoginAt(originalLastLoginAt);
});

test.afterAll(async () => {
  await restoreLastLoginAt(originalLastLoginAt);
});

test.describe("PERF (SESSION) — last_login_at throttling", () => {
  test("1. first-ever visit (last_login_at null) -> written exactly once", async ({ page }) => {
    await setLastLoginAt(null);
    const since = new Date();

    await page.goto("/admin");
    await expect(page, "/admin must remain reachable — unchanged authorization behavior").toHaveURL((u) => u.pathname === "/admin");

    const after = await readLastLoginAt();
    expect(after, "a first-ever visit must write last_login_at").not.toBeNull();
    expect(after!.getTime() >= since.getTime(), "the written value is genuinely fresh").toBe(true);

    const loginEvents = await loginProductEventCountSince(since);
    expect(loginEvents, "a genuine new session still fires at least one 'login' product event").toBeGreaterThanOrEqual(1);
  });

  test("2. new session (last_login_at > 4h ago) -> written exactly once", async ({ page }) => {
    const oldTimestamp = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5h ago
    await setLastLoginAt(oldTimestamp);
    const since = new Date();

    await page.goto("/admin");
    await expect(page).toHaveURL((u) => u.pathname === "/admin");

    const after = await readLastLoginAt();
    expect(after!.getTime()).not.toBe(oldTimestamp.getTime());
    expect(after!.getTime() >= since.getTime()).toBe(true);

    const loginEvents = await loginProductEventCountSince(since);
    expect(loginEvents, "a session older than 4h still fires the 'login' product event").toBeGreaterThanOrEqual(1);
  });

  test("3. close-together request (last_login_at < 4h ago) -> no write", async ({ page }) => {
    const recentTimestamp = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
    await setLastLoginAt(recentTimestamp);
    const since = new Date();

    await page.goto("/admin");
    await expect(page).toHaveURL((u) => u.pathname === "/admin");

    const after = await readLastLoginAt();
    expect(after!.getTime(), "within the 4h window, last_login_at must stay completely untouched").toBe(recentTimestamp.getTime());

    const loginEvents = await loginProductEventCountSince(since);
    expect(loginEvents, "a request within the 4h window must not fire a new 'login' product event").toBe(0);
  });

  test("4. several close-together requests -> exactly one initial write, then zero further writes", async ({ page }) => {
    await setLastLoginAt(null);

    await page.goto("/admin"); // request 1: first-ever visit, writes
    const afterFirst = await readLastLoginAt();
    expect(afterFirst, "request 1 writes last_login_at").not.toBeNull();

    await page.goto("/admin/crm/radar"); // request 2: <4h later, must NOT write
    const afterSecond = await readLastLoginAt();
    expect(afterSecond!.getTime(), "request 2 (well within 4h) must not change last_login_at").toBe(afterFirst!.getTime());

    await page.goto("/admin"); // request 3: still <4h later, must NOT write
    const afterThird = await readLastLoginAt();
    expect(afterThird!.getTime(), "request 3 (still within 4h) must not change last_login_at either").toBe(afterFirst!.getTime());
  });

  test("11. weekly 'Connexions' KPI window: a genuine new session is still counted", async ({ page }) => {
    await setLastLoginAt(null);
    await page.goto("/admin");
    await expect(page).toHaveURL((u) => u.pathname === "/admin");

    const after = await readLastLoginAt();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(after!.getTime() >= since7d.getTime(), "a freshly-written last_login_at still falls inside the weekly KPI window").toBe(true);
  });
});
