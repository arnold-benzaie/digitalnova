import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { auditDb } from "./helpers/audit-db";
import { auditStaffMemberships, auditStaffUsers } from "../db/audit-schema";

/**
 * Covers the "authenticated with Clerk but no PUBLIC-MAP Audit membership"
 * case for requireAuditSession() (see lib/gbp-audit/session.ts): must
 * redirect cleanly, never throw a raw error, and must not loop.
 * Complements lib/dev-role.test.mjs, which covers the same "no role" /
 * "not authenticated" / "admin" / "client-on-an-admin-page" scenarios for
 * the MAIN app's role model (admin/staff/client) as fast unit tests — this
 * file exercises the AUDIT app's role model (admin/supervisor/staff, "agent"
 * in the UI) end-to-end instead, since getAuditStaffSession's require*Role
 * guards aren't cleanly unit-mockable (see that file's header comment).
 *
 * CLIENT DASHBOARD / PENDING ROUTING FIX — the shared test account
 * (contact@public-map.com) carries a standing ACTIVE EMPLOYEE
 * staff_members row (Axis-C, main DB — see e2e/helpers/main-db-staff.mjs),
 * so its session resolves context="WORKFORCE" (Session Authority: WORKFORCE
 * outranks Axis-A). It is therefore fully ACTIVE in the main app while
 * this test makes it lack Audit access — the exact "active identity
 * blocked only by the separate Audit gate" shape access-pending/page.tsx's
 * own fix targets. It must land on /admin, never render the pending copy
 * (which used to happen here — the bug this file's tests originally,
 * unknowingly, asserted as "expected").
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

test("compte ACTIF (WORKFORCE) sans rôle Audit : redirection propre vers /admin, jamais bloqué sur la page pending, jamais une erreur brute", async ({ page }) => {
  const response = await page.goto("/admin/audit");

  // CLIENT DASHBOARD / PENDING ROUTING FIX — this account is fully ACTIVE
  // (context="WORKFORCE" via its standing EMPLOYEE staff_members row), so
  // requireAuditSession()'s unmarked redirect to /access-pending must be
  // bounced straight through to /admin, never rendering the pending copy.
  await page.waitForURL(/\/admin$/);
  expect(page.url(), "un compte ACTIF ne doit jamais rester sur /access-pending").toMatch(/\/admin$/);
  expect(response?.status(), "la réponse finale ne doit pas être un statut d'erreur serveur").toBeLessThan(500);

  const body = await page.textContent("body");
  expect(body, "ne doit jamais exposer le texte brut d'exception Next").not.toContain("Server Components render");
  expect(body, "ne doit jamais exposer un digest technique").not.toMatch(/digest/i);
  expect(body, "ne doit jamais afficher le message 'compte en attente' à un compte actif").not.toContain("Bienvenue sur PUBLIC-MAP !");
});

test("aucune boucle de redirection : /access-pending redirige immédiatement un compte ACTIF vers /admin, sans rebond ni boucle", async ({ page }) => {
  const response = await page.goto("/access-pending");
  expect(response?.status()).toBeLessThan(400);
  // A redirect loop would either time out (page.goto already has a
  // navigation timeout) or bounce through /sign-in first; asserting the
  // final URL is exactly /admin (this account's real home) rules out both
  // and proves the single, correct redirect happened.
  await page.waitForURL(/\/admin$/);
  expect(page.url()).toMatch(/\/admin$/);
});

for (const path of ["/admin/audit/offres", "/admin/audit/equipe", "/admin/audit/parametres", "/admin/audit/liste"]) {
  test(`compte ACTIF sans rôle Audit : ${path} redirige vers /admin, jamais bloqué sur la page pending`, async ({ page }) => {
    await page.goto(path);
    await page.waitForURL(/\/admin$/);
    expect(page.url()).toMatch(/\/admin$/);
  });
}
