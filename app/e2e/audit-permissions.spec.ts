import { test, expect } from "@playwright/test";

/**
 * Role-based access control for the 3 admin-only pages (requireAuditAdminRole
 * — see lib/gbp-audit/session.ts): Offres, Équipe, Paramètres. The dev
 * server's QA_BYPASS_AUDIT_ROLE env var fixes the session role for its
 * whole process lifetime (see lib/qa-bypass.ts) — this file must be run
 * once per role, with the dev server restarted to match each time:
 *
 *   QA_BYPASS_AUDIT_ROLE=staff      npx playwright test e2e/audit-permissions.spec.ts
 *   QA_BYPASS_AUDIT_ROLE=supervisor npx playwright test e2e/audit-permissions.spec.ts
 *
 * (admin is already covered by the "Permissions" test in
 * audit-module-coverage.spec.ts, run against the suite's default admin bypass.)
 *
 * This file reads the SAME env var, in the Playwright test-runner's own
 * process, purely to know which role's expectations to assert — it does not
 * and cannot change the already-running dev server's role itself.
 */
const role = process.env.QA_BYPASS_AUDIT_ROLE ?? "admin";
const ADMIN_ONLY_PATHS = ["/admin/audit/offres", "/admin/audit/equipe", "/admin/audit/parametres"];

test(`Rôle "${role}" : pages réservées admin — accès refusé et redirection si non-admin`, async ({ page }) => {
  test.skip(role === "admin", "le rôle admin est déjà couvert par audit-module-coverage.spec.ts");

  for (const path of ADMIN_ONLY_PATHS) {
    await page.goto(path);
    // requireAuditAdminRole() calls redirect("/admin/audit") for any
    // non-admin role — never a raw 403 page, never the admin-only content.
    await page.waitForURL(/\/admin\/audit$/);
    expect(page.url(), `${path} n'a pas redirigé le rôle "${role}" vers /admin/audit`).toMatch(/\/admin\/audit$/);
  }
});

test(`Rôle "${role}" : le tableau de bord et Notifications restent accessibles à tous les rôles staff`, async ({ page }) => {
  for (const path of ["/admin/audit", "/admin/audit/liste", "/admin/audit/notifications"]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} devrait être accessible au rôle "${role}"`).toBeLessThan(400);
  }
});
