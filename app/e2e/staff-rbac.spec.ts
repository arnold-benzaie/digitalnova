import { test, expect } from "@playwright/test";
import {
  captureOriginalRole,
  restoreOriginalRole,
  setRole,
  TEST_ACCOUNT_EMAIL,
} from "./helpers/main-db-role.mjs";

/**
 * PHASE 2A.0 — main-app RBAC coverage. First E2E in this repo to exercise
 * the MAIN app's own role model (admin / staff / agent / supervisor /
 * client), complementing lib/dev-role.test.mjs (unit) and
 * lib/actions/user-approval.test.mjs (integration, actions only).
 *
 * It proves two things the Phase 2A.0 backstop is about:
 *   - `client` now FAILS CLOSED at the /admin segment boundary
 *     (app/admin/layout.tsx -> requireInternalStaff), on top of every
 *     per-page requireStaffRole().
 *   - `agent` / `supervisor` keep TODAY's exact transitional behavior:
 *     they reach the CRM/Radar/analytics workspace but not /admin/users
 *     or admin-only integration controls (requireAdminRole()).
 *
 * Safety: this file mutates the ONE shared E2E account's membership role
 * in the local disposable DB (127.0.0.1:5434/public_map_approval_test).
 * It runs SERIAL, restores the role in afterEach (so a crash in one test
 * can't leak into the next) AND afterAll, and the helper hard-fails the
 * run if the role is ever not restored to `admin`. It runs last
 * alphabetically in e2e/, so nothing else in a run depends on its state.
 */
test.describe.configure({ mode: "serial" });
test.use({ locale: "fr-FR" });

const ADMIN_ORG_ID = "0d01cb3f-5162-409e-a0b3-8aae67694786"; // PUBLIC-MAP internal org (see e2e/helpers/main-db-role.mjs capture)

// Representative routes per gate group — not every /admin page, since
// route groups share one gate (see the Phase 2A.0-A audit's route matrix).
const STAFF_OK_ROUTES = ["/admin", "/admin/crm/clients", "/admin/crm/radar", "/admin/crm/performance"];
const ADMIN_ONLY_ROUTES = ["/admin/users", `/admin/integrations/${ADMIN_ORG_ID}/api-keys`];

let ctx: Awaited<ReturnType<typeof captureOriginalRole>>;

test.beforeAll(async () => {
  ctx = await captureOriginalRole(); // throws unless baseline is exactly `admin`
});

test.afterEach(async () => {
  await restoreOriginalRole(ctx); // idempotent; verifies role is back to `admin`
});

test.afterAll(async () => {
  await restoreOriginalRole(ctx); // final backstop; throws loudly if not restored
});

test.describe("Main-app RBAC — /admin boundary", () => {
  test("unauthenticated: /admin redirects to /sign-in", async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: undefined })).newPage();
    await page.goto("/admin");
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toMatch(/\/sign-in/);
    await page.close();
  });

  test("client: every /admin surface fails closed and lands on /dashboard", async ({ page }) => {
    await setRole(ctx, "client");
    for (const route of [...STAFF_OK_ROUTES, ...ADMIN_ONLY_ROUTES]) {
      await page.goto(route);
      await page.waitForURL(/\/dashboard/);
      expect(page.url(), `${route} did not fail closed for client`).toMatch(/\/dashboard/);
    }
  });

  for (const role of ["agent", "supervisor"] as const) {
    test(`${role}: reaches the CRM/Radar/analytics workspace`, async ({ page }) => {
      await setRole(ctx, role);
      for (const route of STAFF_OK_ROUTES) {
        await page.goto(route);
        // Stays on the requested route — NOT bounced to /dashboard (client
        // backstop) or /sign-in (no session). toHaveURL polls, so a slow
        // first compile doesn't flake it.
        await expect(page, `${route} should be reachable by ${role}`).toHaveURL((u) => u.pathname === route);
      }
    });

    test(`${role}: denied /admin/users and admin-only integration controls (-> /admin)`, async ({ page }) => {
      await setRole(ctx, role);
      for (const route of ADMIN_ONLY_ROUTES) {
        await page.goto(route);
        // requireAdminRole() redirects a non-admin staffer to exactly
        // /admin — never the admin-only content, never /dashboard or
        // /sign-in. `=== "/admin"` also asserts it did NOT stay on the
        // requested sub-route.
        await expect(page, `${route} should be admin-only for ${role}`).toHaveURL((u) => u.pathname === "/admin");
      }
    });
  }

  test(`admin (restored baseline): /admin and /admin/users both load`, async ({ page }) => {
    // ctx baseline is `admin`; afterEach restored it, so no setRole() here.
    for (const route of ["/admin", "/admin/users"]) {
      await page.goto(route);
      await expect(page, `${route} should load for admin`).toHaveURL((u) => u.pathname === route);
    }
    expect(TEST_ACCOUNT_EMAIL).toBe("contact@public-map.com");
  });
});
