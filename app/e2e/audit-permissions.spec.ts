import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { auditDb } from "./helpers/audit-db";
import { auditStaffMemberships, auditStaffRoles, auditStaffUsers } from "../db/audit-schema";

/**
 * Role-based access control for the 3 admin-only pages (requireAuditAdminRole
 * — see lib/gbp-audit/session.ts): Offres, Équipe, Paramètres.
 *
 * The single real, already-authenticated test session (contact@public-map.com
 * — see e2e/auth-setup.mjs) is reused for every role in this file: its
 * audit_staff_memberships row in the LOCAL Docker database is swapped to
 * each target role before that role's tests, and restored to "admin" in
 * afterAll so later spec files in the same run see the expected baseline.
 * (admin itself is already covered by the "Permissions" test in
 * audit-module-coverage.spec.ts.)
 */
const ADMIN_ONLY_PATHS = ["/admin/audit/offres", "/admin/audit/equipe", "/admin/audit/parametres"];
const CLERK_USER_ID = "user_3GVa84nBjinLnBEr6veCyFzEUsE"; // contact@public-map.com

async function setRole(roleName: "admin" | "staff" | "supervisor") {
  const [staffUser] = await auditDb.select().from(auditStaffUsers).where(eq(auditStaffUsers.clerkUserId, CLERK_USER_ID)).limit(1);
  if (!staffUser) throw new Error(`audit_staff_users introuvable pour ${CLERK_USER_ID} — lancer e2e/auth-setup.mjs puis scripts/audit-bootstrap-first-admin.mjs d'abord.`);
  const [role] = await auditDb.select().from(auditStaffRoles).where(eq(auditStaffRoles.name, roleName)).limit(1);
  if (!role) throw new Error(`Rôle "${roleName}" introuvable dans audit_staff_roles.`);
  await auditDb.update(auditStaffMemberships).set({ roleId: role.id }).where(eq(auditStaffMemberships.userId, staffUser.id));
}

test.afterAll(async () => {
  await setRole("admin");
});

for (const role of ["staff", "supervisor"] as const) {
  test.describe(`Rôle "${role}"`, () => {
    test.beforeAll(async () => {
      await setRole(role);
    });

    test(`pages réservées admin — accès refusé et redirection`, async ({ page }) => {
      for (const path of ADMIN_ONLY_PATHS) {
        await page.goto(path);
        // requireAuditAdminRole() calls redirect("/admin/audit") for any
        // non-admin role — never a raw 403 page, never the admin-only content.
        await page.waitForURL(/\/admin\/audit$/);
        expect(page.url(), `${path} n'a pas redirigé le rôle "${role}" vers /admin/audit`).toMatch(/\/admin\/audit$/);
      }
    });

    test(`le tableau de bord et Notifications restent accessibles`, async ({ page }) => {
      for (const path of ["/admin/audit", "/admin/audit/liste", "/admin/audit/notifications"]) {
        const res = await page.goto(path);
        expect(res?.status(), `${path} devrait être accessible au rôle "${role}"`).toBeLessThan(400);
      }
    });
  });
}
