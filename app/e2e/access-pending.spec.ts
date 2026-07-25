import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { auditDb } from "./helpers/audit-db";
import { auditStaffMemberships, auditStaffUsers } from "../db/audit-schema";

/**
 * Covers the "authenticated with Clerk but no PUBLIC-MAP Audit membership"
 * case for requireAuditSession() (see lib/gbp-audit/session.ts): must
 * redirect to /access-pending, never throw a raw error, and must not loop.
 * Complements lib/dev-role.test.mjs, which covers the same "no role" /
 * "not authenticated" / "admin" / "client-on-an-admin-page" scenarios for
 * the MAIN app's role model (admin/staff/client) as fast unit tests — this
 * file exercises the AUDIT app's role model (admin/supervisor/staff, "agent"
 * in the UI) end-to-end instead, since getAuditStaffSession's require*Role
 * guards aren't cleanly unit-mockable (see that file's header comment).
 *
 * Same real, already-authenticated test session (contact@public-map.com —
 * see e2e/auth-setup.mjs) reused by every file in this suite: its
 * audit_staff_memberships row in the LOCAL Docker database is removed
 * entirely (not just swapped to a different role — this test needs "no
 * membership row at all") before the test, and restored to its original
 * role in afterAll so later spec files in the same run see the expected
 * admin baseline (mirrors audit-permissions.spec.ts's own pattern).
 *
 * Looked up by EMAIL, not a hardcoded Clerk user id — audit_staff_users.id
 * is a local Docker-DB primary key, and .clerkUserId is only whichever
 * Clerk instance last signed this person in (see e2e/auth-setup.mjs's own
 * header comment: a hardcoded id goes stale the moment the Clerk instance
 * changes, exactly what happened when .env.local moved to Production
 * keys). The email is the one thing that's stable across that change.
 */
// Pinned so the French-text assertions below are deterministic — playwright.config.ts
// sets no locale, so Chromium's own default (not necessarily French) would
// otherwise apply, making /access-pending correctly render in English and
// fail an assertion that expected French. Scoped to this file only, not
// the shared config: every other spec in this suite doesn't assert on
// language-specific copy and shouldn't be forced onto one locale.
test.use({ locale: "fr-FR" });

const ADMIN_EMAIL = "contact@public-map.com";

let removedRoleId: string | null = null;

test.beforeAll(async () => {
  const [staffUser] = await auditDb.select().from(auditStaffUsers).where(eq(auditStaffUsers.email, ADMIN_EMAIL)).limit(1);
  if (!staffUser) throw new Error(`audit_staff_users introuvable pour ${ADMIN_EMAIL} — lancer e2e/auth-setup.mjs puis scripts/audit-bootstrap-first-admin.mjs d'abord.`);

  const [membership] = await auditDb.select().from(auditStaffMemberships).where(eq(auditStaffMemberships.userId, staffUser.id)).limit(1);
  if (!membership) throw new Error(`audit_staff_memberships introuvable pour ${ADMIN_EMAIL} avant même de retirer l'accès — état de départ inattendu.`);
  removedRoleId = membership.roleId;

  await auditDb.delete(auditStaffMemberships).where(eq(auditStaffMemberships.userId, staffUser.id));
});

test.afterAll(async () => {
  if (!removedRoleId) return;
  const [staffUser] = await auditDb.select().from(auditStaffUsers).where(eq(auditStaffUsers.email, ADMIN_EMAIL)).limit(1);
  if (!staffUser) return;
  await auditDb
    .insert(auditStaffMemberships)
    .values({ userId: staffUser.id, roleId: removedRoleId })
    .onConflictDoNothing({ target: auditStaffMemberships.userId });
});

test("compte authentifié sans aucun rôle Audit : redirection propre vers /access-pending, jamais une erreur brute", async ({ page }) => {
  const response = await page.goto("/admin/audit");

  await page.waitForURL(/\/access-pending$/);
  expect(page.url(), "devrait atterrir sur /access-pending, pas rester sur une page d'erreur").toMatch(/\/access-pending$/);
  expect(response?.status(), "la réponse finale ne doit pas être un statut d'erreur serveur").toBeLessThan(500);

  const body = await page.textContent("body");
  expect(body, "ne doit jamais exposer le texte brut d'exception Next").not.toContain("Server Components render");
  expect(body, "ne doit jamais exposer un digest technique").not.toMatch(/digest/i);

  await expect(page.getByRole("heading", { level: 1, name: "Bienvenue sur PUBLIC-MAP !" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contacter PUBLIC-MAP" })).toHaveAttribute("href", "mailto:contact@public-map.com");
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Retour au site PUBLIC-MAP" })).toHaveAttribute("href", "https://www.public-map.com");
});

test("aucune boucle de redirection : /access-pending se charge directement sans rebond", async ({ page }) => {
  const response = await page.goto("/access-pending");
  expect(response?.status()).toBeLessThan(400);
  // A redirect loop would either time out (page.goto already has a
  // navigation timeout) or bounce through /sign-in first; asserting the
  // final URL is exactly this page rules out both.
  expect(page.url()).toMatch(/\/access-pending$/);
});

for (const path of ["/admin/audit/offres", "/admin/audit/equipe", "/admin/audit/parametres", "/admin/audit/liste"]) {
  test(`compte sans rôle Audit : ${path} redirige aussi vers /access-pending`, async ({ page }) => {
    await page.goto(path);
    await page.waitForURL(/\/access-pending$/);
    expect(page.url()).toMatch(/\/access-pending$/);
  });
}
