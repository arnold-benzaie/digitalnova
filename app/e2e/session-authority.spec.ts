import { test, expect } from "@playwright/test";
import { captureOriginalRole, restoreOriginalRole, setRole, removeMembership, restoreMembership } from "./helpers/main-db-role.mjs";
import { ensureRadarStaffMember, removeStaffMember } from "./helpers/main-db-staff.mjs";

/**
 * SESSION AUTHORITY UNIFICATION — browser-level proof of the three
 * scenarios lib/session.ts's resolveAccessState() must now resolve
 * correctly, complementing lib/dev-role.test.mjs / lib/admin-access.test.mjs
 * (unit, mocked Clerk) and the existing staff-rbac.spec.ts / crm-radar.spec.ts
 * / ai-governance.spec.ts (real Clerk, but each exercises only ONE axis at
 * a time):
 *
 *   1. Axis-C ACTIVE, NO Axis-A membership row at all -> context="WORKFORCE",
 *      /admin reachable, RADAR reachable per permission.
 *   2. Axis-A "client", NO Axis-C row -> context="CLIENT", /dashboard
 *      reachable, /admin refused (existing behavior, unchanged).
 *   3. BOTH at once (Axis-A "client" + Axis-C EMPLOYEE ACTIVE) ->
 *      context="WORKFORCE" wins unconditionally — the exact shape the
 *      Samira production anomaly has (see the read-only investigation of
 *      that account; this file changes no Production data, only this
 *      shared local-test identity) — and proves no permission fusion:
 *      the resolved identity is admitted as EMPLOYEE-mapped ("agent"), not
 *      as a client, and NOT as an admin.
 *
 * Mutates the ONE shared E2E account (contact@public-map.com) in the local
 * disposable DB, same safety model as staff-rbac.spec.ts: runs SERIAL,
 * restores in afterEach AND afterAll, hard-verifies every restore.
 * removeMembership()/restoreMembership() (main-db-role.mjs) are new for
 * this file — see their own docstrings for why deleting the row (not just
 * changing its role_id) is safe here and nowhere else in this suite.
 */
test.describe.configure({ mode: "serial" });
test.use({ locale: "fr-FR" });

const ADMIN_ORG_ID = "0d01cb3f-5162-409e-a0b3-8aae67694786"; // PUBLIC-MAP internal org (see e2e/helpers/main-db-role.mjs capture)

let ctx: Awaited<ReturnType<typeof captureOriginalRole>>;

test.beforeAll(async () => {
  ctx = await captureOriginalRole(); // throws unless baseline is exactly `admin`
});

test.afterEach(async () => {
  // Idempotent regardless of which of the two axes the test touched:
  // restoreMembership() is a no-op if the row was never removed (or
  // restoreOriginalRole() already ran), and ensureRadarStaffMember() is a
  // no-op if the standing EMPLOYEE seed was never removed either.
  await restoreMembership(ctx);
  await restoreOriginalRole(ctx);
  await ensureRadarStaffMember();
});

test.afterAll(async () => {
  await restoreMembership(ctx);
  await restoreOriginalRole(ctx);
  await ensureRadarStaffMember();
});

test.describe("Session authority unification — Axis-A / Axis-C priority", () => {
  test("WORKFORCE pure (Axis-C ACTIVE, no Axis-A membership at all): /admin reachable, RADAR reachable per permission", async ({ page }) => {
    await removeMembership(ctx); // no memberships row for this account at all
    await ensureRadarStaffMember(); // standing EMPLOYEE seed — RADAR_QUEUE_VIEW + RADAR_WORK, not RADAR_ASSIGN

    await page.goto("/admin");
    await expect(page, "/admin must be reachable for a pure WORKFORCE identity").toHaveURL((u) => u.pathname === "/admin");

    await page.goto("/admin/crm/radar");
    await expect(page, "RADAR must be reachable — EMPLOYEE holds RADAR_QUEUE_VIEW").toHaveURL((u) => u.pathname === "/admin/crm/radar");

    // No fusion in the other direction either: admin-only content must
    // still be denied for a pure EMPLOYEE identity (legacyAppRoleForWorkforce
    // maps EMPLOYEE -> "agent", never "admin").
    await page.goto("/admin/users");
    await expect(page, "admin-only /admin/users must stay denied for EMPLOYEE").toHaveURL((u) => u.pathname === "/admin");
  });

  test("CLIENT pure (Axis-A 'client', no Axis-C row): /dashboard reachable, /admin refused", async ({ page }) => {
    await removeStaffMember(); // no staff_members row for this account at all
    await setRole(ctx, "client");

    await page.goto("/dashboard");
    await expect(page, "/dashboard must be reachable for a pure CLIENT identity").toHaveURL((u) => u.pathname === "/dashboard");

    await page.goto("/admin");
    await page.waitForURL(/\/dashboard/);
    expect(page.url(), "/admin must fail closed to /dashboard for a pure CLIENT identity").toMatch(/\/dashboard/);
  });

  test("double context (Axis-A 'client' + Axis-C EMPLOYEE ACTIVE): resolves as WORKFORCE, no fusion", async ({ page }) => {
    await setRole(ctx, "client"); // Axis-A says client
    await ensureRadarStaffMember(); // Axis-C says ACTIVE EMPLOYEE, at the same time

    // WORKFORCE wins unconditionally: /admin must be reachable, NOT bounced
    // to /dashboard the way the pure-CLIENT test above proved it would be
    // if this row didn't exist.
    await page.goto("/admin");
    await expect(page, "double-context identity must resolve as WORKFORCE, reaching /admin").toHaveURL((u) => u.pathname === "/admin");

    await page.goto("/admin/crm/radar");
    await expect(page, "RADAR must be reachable via the Axis-C EMPLOYEE side of the double context").toHaveURL(
      (u) => u.pathname === "/admin/crm/radar",
    );

    // No fusion: the Axis-A "client" role must contribute nothing, and the
    // resolved identity must not be treated as admin either (EMPLOYEE maps
    // to "agent", not "admin" — see lib/session.ts's legacyAppRoleForWorkforce).
    await page.goto("/admin/users");
    await expect(page, "admin-only /admin/users must stay denied — no privilege escalation from the CLIENT side").toHaveURL(
      (u) => u.pathname === "/admin",
    );
    await page.goto(`/admin/integrations/${ADMIN_ORG_ID}/api-keys`);
    await expect(page, "admin-only integration controls must stay denied too").toHaveURL((u) => u.pathname === "/admin");
  });
});
