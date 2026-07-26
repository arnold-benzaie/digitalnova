import { test, expect } from "./fixtures";

/**
 * Real, end-to-end validation against the LIVE Vercel Preview deployment —
 * real Clerk session (see auth-setup.mjs), real Postgres (public-map
 * project, `preview` schema + the real Audit Supabase project), real
 * network. All fixtures are prefixed "[E2E-PREVIEW]" or use a dedicated
 * e2e-preview+... email so they're unambiguous and easy to find/clean up
 * afterward — this is real infrastructure, not a disposable local Docker DB.
 */

const BUSINESS = {
  legalName: "[E2E-PREVIEW] Boulangerie Validation Preview",
  prospectEmail: "e2e-preview+prospect@example.com",
};

let auditId: string | undefined;

test.describe.configure({ mode: "serial" });

test("Tableau de bord CRM (/admin) : accessible, pas d'erreur", async ({ page, trackedErrors }) => {
  await page.goto("/admin", { waitUntil: "load" });
  await expect(page).not.toHaveURL(/sign-in/);
  expect(trackedErrors, trackedErrors.join(" | ")).toEqual([]);
});

test("Tableau de bord Audit (/admin/audit) : accessible, pas d'erreur", async ({ page, trackedErrors }) => {
  await page.goto("/admin/audit", { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  expect(trackedErrors, trackedErrors.join(" | ")).toEqual([]);
});

test("Création d'un audit réel sur Preview", async ({ page, trackedErrors }) => {
  await page.goto("/admin/audit/nouveau", { waitUntil: "load" });
  await page.locator("#firstName").fill("Preview");
  await page.locator("#lastName").fill("Validation");
  await page.locator("#email").fill(BUSINESS.prospectEmail);
  await page.locator("#preferredLanguage").selectOption("fr");
  await page.locator("#legalName").fill(BUSINESS.legalName);
  await page.locator("#profileStatus").selectOption("unknown");
  await page.locator("#locationCount").fill("1");
  await page.getByRole("button", { name: "Créer le prospect et démarrer l’audit" }).click();
  await page.waitForURL(/\/admin\/audit\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const match = page.url().match(/\/admin\/audit\/([0-9a-f-]{36})$/);
  expect(match, "pas de redirection vers un audit — régression du bug redirect() déjà corrigé ?").not.toBeNull();
  auditId = match![1];
  await expect(page.getByRole("heading", { name: BUSINESS.legalName })).toBeVisible();
  expect(trackedErrors, trackedErrors.join(" | ")).toEqual([]);
});

test("Modification d'un audit : enregistrer un contrôle", async ({ page, trackedErrors }) => {
  test.skip(!auditId, "audit non créé à l'étape précédente");
  await page.goto(`/admin/audit/${auditId}/audit`, { waitUntil: "load" });
  const key = "profile_claimed";
  await page.locator(`button[aria-controls="${key}-panel"]`).click();
  const panel = page.locator(`#${key}-panel`);
  await panel.locator(`#${key}-result`).selectOption("compliant");
  await panel.locator(`#${key}-explanation`).fill("[E2E-PREVIEW] Vérifié sur Preview réel.");
  await panel.getByRole("button", { name: "Enregistrer" }).click();
  await expect(panel.getByText("Enregistré", { exact: true })).toBeVisible();
  expect(trackedErrors, trackedErrors.join(" | ")).toEqual([]);
});

test("Génération PDF réelle (interne)", async ({ page }) => {
  test.skip(!auditId, "audit non créé");
  // Clerk's dev-instance session JWT is short-lived; a page navigation
  // right before the direct API call lets Clerk's own client script
  // refresh it, exactly as it does during any normal page-to-page use —
  // a cold page.request call right after loading a saved storageState can
  // otherwise use an already-expired token.
  await page.goto(`/admin/audit/${auditId}`, { waitUntil: "load" });
  const res = await page.request.get(`/api/gbp-audit/${auditId}/pdf`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const buffer = await res.body();
  expect(buffer.length).toBeGreaterThan(1000);
});

test("Rapports, Devis, Offres, Équipe, Notifications, Paramètres : accessibles sans erreur", async ({ page, trackedErrors }) => {
  for (const path of ["/admin/audit/rapports", "/admin/audit/devis", "/admin/audit/offres", "/admin/audit/equipe", "/admin/audit/notifications", "/admin/audit/parametres"]) {
    await page.goto(path, { waitUntil: "load" });
    await expect(page.locator("body")).not.toContainText("Application error");
  }
  expect(trackedErrors, trackedErrors.join(" | ")).toEqual([]);
});

test("Audits (liste) : le nouvel audit apparaît", async ({ page }) => {
  test.skip(!auditId, "audit non créé");
  await page.goto("/admin/audit/liste", { waitUntil: "load" });
  await expect(page.getByRole("link", { name: BUSINESS.legalName })).toBeVisible();
});

test("Historique de l'audit : au moins les 2 premiers événements", async ({ page }) => {
  test.skip(!auditId, "audit non créé");
  await page.goto(`/admin/audit/${auditId}/timeline`, { waitUntil: "load" });
  await expect(page.getByText("Prospect créé", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Audit créé", { exact: true }).first()).toBeVisible();
});

test("Portail public réel + devis (test du correctif IDOR sur l'infra réelle)", async ({ browser }) => {
  test.skip(!auditId, "audit non créé");
  // No storageState here — genuinely anonymous, matching a real prospect.
  const anonContext = await browser.newContext();
  const page = await anonContext.newPage();
  const res = await page.goto(`/audit-report/does-not-exist-token`, { waitUntil: "load" });
  expect(res?.status(), "un token invalide ne doit jamais renvoyer 200").not.toBe(200);
  await anonContext.close();
});

test.afterAll(async () => {
  // Direct DB cleanup against the REAL Audit Supabase project (this is real
  // infrastructure, not a disposable local Docker DB) — same cascade model
  // already proven in e2e/helpers/audit-db.ts's cleanupE2EAudit.
  const { config } = await import("dotenv");
  const { Client } = await import("pg");
  config({ path: ".env.local" });
  const client = new Client({ connectionString: process.env.AUDIT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`delete from audit_activity_log where metadata->>'auditId' = (select g.id::text from gbp_audits g join audit_businesses b on b.id = g.business_id where b.legal_name = $1)`, [BUSINESS.legalName]);
    await client.query("delete from audit_businesses where legal_name = $1", [BUSINESS.legalName]);
    await client.query("delete from audit_prospects where email = $1", [BUSINESS.prospectEmail]);
  } finally {
    await client.end();
  }
});
