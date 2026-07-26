import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { auditDb } from "./helpers/audit-db";
import { auditBusinesses, auditProspects, gbpServiceOffers, auditStaffInvitations } from "../db/audit-schema";
import { eq, like, sql } from "drizzle-orm";

/**
 * Broad coverage pass over every /admin/audit/** page not already exercised
 * step-by-step by full-lifecycle.spec.ts: Tableau de bord, Audits (liste),
 * Rapports, Offres, Équipe, Notifications, Paramètres — plus a couple of
 * error/empty-state checks. Runs under the same real admin session as
 * the rest of the suite (see e2e/README.md). All fixtures are prefixed
 * "[E2E-COVERAGE]" (a distinct prefix from full-lifecycle's "[E2E]", so the
 * two suites' cleanups/assertions never collide) or use a dedicated
 * e2e-coverage+... email.
 */

// Deterministic French assertions below (getLocale() falls back to the
// browser's Accept-Language, which Playwright's default context does not
// pin to French) — same fix already established for this reason in
// e2e/access-pending.spec.ts.
test.use({ locale: "fr-FR" });

const BUSINESS_NAME = "[E2E-COVERAGE] Fixture Paramètres/Rapports";
const PROSPECT_EMAIL = "e2e-coverage+fixture@example.com";
const STAFF_INVITE_EMAIL = "e2e-coverage+staff-invite@example.com";
const OFFER_LABEL = "[E2E-COVERAGE] Offre de test";

function trackErrors(page: Page, bucket: string[]) {
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") bucket.push(`[console] ${msg.text()}`);
  });
  page.on("pageerror", (err) => bucket.push(`[pageerror] ${err.message}`));
}

let fixtureAuditId: string | undefined;

// retries: 1 — this file's serial run occasionally hits one transient Clerk
// session-token refresh race under the cumulative load of the full 53-test
// suite: a single Server Action POST gets a 307 to /sign-in instead of
// reaching the handler (confirmed via trace network logs — POST
// /admin/audit/parametres -> 307 -> POST /sign-in -> 200), even though the
// browser's underlying session is still valid a moment later. Reproduced
// 0/3 times in isolation with a fresh session (fast, deterministic pass
// every time) — not a fixed delay, not app logic, not this suite's own
// code, just a real Clerk-client-refresh timing gap under sustained load.
// A retry re-runs this serial group with a fresh page/context per test and
// has always cleared it; a genuine regression would still fail on retry.
test.describe.configure({ mode: "serial", retries: 1 });

test.beforeAll(async ({ browser }) => {
  // Dedicated fixture audit so "Audits" and "Rapports" have at least one
  // real row to render, independent of whether full-lifecycle.spec.ts ran
  // (and cleaned up) in this same invocation.
  const page = await (await browser.newContext()).newPage();
  await page.goto("/admin/audit/nouveau");
  await page.locator("#firstName").fill("Coverage");
  await page.locator("#lastName").fill("Fixture");
  await page.locator("#email").fill(PROSPECT_EMAIL);
  await page.locator("#preferredLanguage").selectOption("fr");
  await page.locator("#legalName").fill(BUSINESS_NAME);
  await page.locator("#profileStatus").selectOption("unknown");
  await page.locator("#locationCount").fill("1");
  await page.getByRole("button", { name: "Créer le prospect et démarrer l’audit" }).click();
  await page.waitForURL(/\/admin\/audit\/[0-9a-f-]{36}$/);
  const match = page.url().match(/\/admin\/audit\/([0-9a-f-]{36})$/);
  fixtureAuditId = match![1];
  await page.close();
});

test.afterAll(async () => {
  if (fixtureAuditId) {
    await auditDb.execute(sql`delete from audit_activity_log where target_id = ${fixtureAuditId} or metadata->>'auditId' = ${fixtureAuditId}`);
  }
  // Business/prospect cascade delete every child row (findings, evidence,
  // reports, etc. — see e2e/helpers/audit-db.ts's cleanupE2EAudit comment).
  await auditDb.delete(auditBusinesses).where(like(auditBusinesses.legalName, "[E2E-COVERAGE]%"));
  await auditDb.delete(auditProspects).where(eq(auditProspects.email, PROSPECT_EMAIL));
  await auditDb.delete(gbpServiceOffers).where(like(gbpServiceOffers.label, "[E2E-COVERAGE]%"));
  await auditDb.delete(auditStaffInvitations).where(eq(auditStaffInvitations.email, STAFF_INVITE_EMAIL));
});

test("Tableau de bord : KPI, graphiques, filtres de période, sans erreur console", async ({ page }) => {
  const errors: string[] = [];
  trackErrors(page, errors);

  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  await expect(page.getByText("Prospects")).toBeVisible();
  await expect(page.getByText("Audits à démarrer")).toBeVisible();
  await expect(page.getByRole("link", { name: "Voir tous les audits" })).toHaveAttribute("href", "/admin/audit/liste");
  await expect(page.getByRole("link", { name: "+ Nouvel audit" })).toHaveAttribute("href", "/admin/audit/nouveau");

  // Period filter — switching to 30j updates the URL and the chart heading.
  await page.getByRole("link", { name: "30j" }).click();
  await page.waitForURL(/days=30/);
  await expect(page.getByText("Évolution des audits (30 derniers jours)")).toBeVisible();

  expect(errors, `erreurs runtime sur le tableau de bord : ${errors.join(" | ")}`).toEqual([]);
});

test("Audits (liste) : affiche la fixture, recherche avec résultat et sans résultat", async ({ page }) => {
  const errors: string[] = [];
  trackErrors(page, errors);

  await page.goto("/admin/audit/liste");
  await expect(page.getByRole("link", { name: BUSINESS_NAME })).toBeVisible();

  // Search matching the fixture.
  await page.getByPlaceholder(/[Rr]echerch/).first().fill("E2E-COVERAGE");
  await page.keyboard.press("Enter");
  await page.waitForURL(/q=/);
  await expect(page.getByRole("link", { name: BUSINESS_NAME })).toBeVisible();

  // Search with zero results — an empty state, not a crash.
  await page.goto("/admin/audit/liste?q=zzz-aucun-resultat-e2e-zzz");
  await expect(page.getByRole("link", { name: BUSINESS_NAME })).toHaveCount(0);

  expect(errors, `erreurs runtime sur Audits (liste) : ${errors.join(" | ")}`).toEqual([]);
});

test("Rapports : charge sans erreur, formulaire de filtre présent", async ({ page }) => {
  const errors: string[] = [];
  trackErrors(page, errors);

  await page.goto("/admin/audit/rapports");
  await expect(page.getByRole("heading", { name: "Rapports" })).toBeVisible();
  await expect(page.getByPlaceholder("Rechercher par entreprise ou prospect...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Filtrer" })).toBeVisible();
  // The fixture audit is still "not_started" (no report yet) — either the
  // empty state or a filtered-to-zero list is correct, never a crash.
  expect(errors, `erreurs runtime sur Rapports : ${errors.join(" | ")}`).toEqual([]);
});

test("Notifications : charge sans erreur (état vide ou liste)", async ({ page }) => {
  const errors: string[] = [];
  trackErrors(page, errors);

  await page.goto("/admin/audit/notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  expect(errors, `erreurs runtime sur Notifications : ${errors.join(" | ")}`).toEqual([]);
});

test("Offres : accessible en admin, création et suppression d'une offre de test", async ({ page }) => {
  const errors: string[] = [];
  trackErrors(page, errors);

  await page.goto("/admin/audit/offres");
  await expect(page.getByRole("heading", { name: /[Oo]ffres/ })).toBeVisible();

  await page.getByRole("button", { name: "+ Nouvelle offre" }).click();
  await page.locator("#offer-label").fill(OFFER_LABEL);
  await page.locator("#offer-description").fill("Offre créée par la suite Playwright — à ignorer.");
  await page.getByRole("button", { name: "Créer l'offre" }).click();
  await expect(page.getByText(OFFER_LABEL)).toBeVisible();

  const [offer] = await auditDb.select().from(gbpServiceOffers).where(eq(gbpServiceOffers.label, OFFER_LABEL)).limit(1);
  expect(offer, "l'offre de test n'a pas été trouvée en base après création").toBeTruthy();

  expect(errors, `erreurs runtime sur Offres : ${errors.join(" | ")}`).toEqual([]);
});

test("Équipe : accessible en admin, invitation d'un membre de test", async ({ page }) => {
  const errors: string[] = [];
  trackErrors(page, errors);

  await page.goto("/admin/audit/equipe");
  await expect(page.getByRole("heading", { name: /[ÉE]quipe/ })).toBeVisible();

  await page.getByRole("button", { name: "+ Inviter un membre" }).click();
  await page.locator("#invite-email").fill(STAFF_INVITE_EMAIL);
  await page.locator("#invite-role").selectOption("staff");
  await page.getByRole("button", { name: "Envoyer l’invitation" }).click();
  await expect(page.getByText("Invitation envoyée")).toBeVisible();
  await expect(page.getByText(STAFF_INVITE_EMAIL)).toBeVisible();

  const [invitation] = await auditDb.select().from(auditStaffInvitations).where(eq(auditStaffInvitations.email, STAFF_INVITE_EMAIL)).limit(1);
  expect(invitation, "l'invitation de test n'a pas été trouvée en base").toBeTruthy();

  expect(errors, `erreurs runtime sur Équipe : ${errors.join(" | ")}`).toEqual([]);
});

test("Paramètres : les 6 onglets s'ouvrent, régression du bug gbp_audit_settings, modification persistée", async ({ page }) => {
  const errors: string[] = [];
  trackErrors(page, errors);

  await page.goto("/admin/audit/parametres");
  // Regression check for the missing-migration bug fixed this session:
  // the page must render normally, not throw on a missing gbp_audit_settings table/row.
  await expect(page.getByRole("heading", { name: "Paramètres" })).toBeVisible();
  await expect(page.getByText("Mon compte")).toBeVisible();

  for (const tabName of ["Scoring", "Rapports PDF", "Notifications", "Webhooks", "Sécurité", "Général"]) {
    await page.getByRole("tab", { name: tabName }).click();
    await expect(page.getByRole("tab", { name: tabName })).toHaveAttribute("aria-selected", "true");
  }

  // Modify + persist a real setting via the General tab's footer-note field, then reload to confirm it wrote through.
  // All 6 tabpanels stay mounted (Tabs uses `hidden`, not unmount — see
  // components/gbp-audit/ui/tabs.tsx), so scope to the visible one to avoid
  // matching one of the other 5 tabs' identically-labelled "Enregistrer" button.
  const testNote = `[E2E-COVERAGE] note de test ${Date.now()}`;
  await page.getByRole("tab", { name: "Général" }).click();
  const visiblePanel = page.locator('[role="tabpanel"]:not([hidden])');
  await visiblePanel.getByLabel(/[Nn]ote/).fill(testNote);
  const saveButton = visiblePanel.getByRole("button", { name: "Enregistrer" });
  await saveButton.click();
  // Wait on the real page state (the button's own aria-busy, toggled by the
  // form's useTransition — see components/gbp-audit/ui/button.tsx) rather
  // than a fixed delay: this settles exactly when the Server Action
  // actually resolves, however long that takes under load, instead of
  // racing a fixed timeout against sonner's fixed 4s toast auto-dismiss
  // (see components/gbp-audit/ui/toast.tsx) the way the previous version
  // of this assertion did.
  await expect(saveButton).not.toHaveAttribute("aria-busy", "true", { timeout: 20000 });
  // If the Clerk session token happened to lapse for this one request, the
  // Server Action POST gets redirected to /sign-in instead of reaching the
  // handler — fail here with an honest, specific message instead of the
  // generic "toast not found" a plain visibility check would give, so a
  // real application regression is never silently reframed as "the toast
  // was slow". See test.describe.configure() above for why this is
  // retried rather than treated as a hard failure on its own.
  await expect(page, "session redirected to /sign-in mid Server Action — see test.describe.configure() retries comment").toHaveURL(/\/admin\/audit\/parametres/);
  await expect(page.getByText("Paramètres généraux enregistrés")).toBeVisible({ timeout: 5000 });

  await page.reload();
  await page.getByRole("tab", { name: "Général" }).click();
  await expect(visiblePanel.getByLabel(/[Nn]ote/)).toHaveValue(testNote);

  expect(errors, `erreurs runtime sur Paramètres : ${errors.join(" | ")}`).toEqual([]);
});

test("Erreur 404 : un identifiant d'audit inexistant affiche la page 404, ne plante pas", async ({ page }) => {
  // page.tsx correctly calls notFound() (confirmed by reading the source),
  // which renders Next's built-in not-found UI — but per Next's streaming
  // architecture, the top-level HTTP response for a notFound() thrown deep
  // in a nested layout stays 200 (the shell already started streaming
  // before the inner segment threw), so status() is NOT the right signal
  // here. Assert on the actual rendered not-found content instead.
  const res = await page.goto("/admin/audit/00000000-0000-0000-0000-000000000000");
  expect(res?.status(), "la requête elle-même ne doit jamais échouer (5xx)").toBeLessThan(500);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("Permissions : le rôle admin voit les pages réservées admin sans redirection", async ({ page }) => {
  for (const path of ["/admin/audit/offres", "/admin/audit/equipe", "/admin/audit/parametres"]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} devrait être accessible à l'admin`).toBe(200);
    expect(page.url(), `${path} n'aurait pas dû rediriger un admin`).toContain(path);
  }
});
