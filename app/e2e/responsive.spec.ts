import { test, expect } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console-errors";

/**
 * Responsive smoke pass — desktop/tablet/mobile on the key Audit pages.
 * Read-only navigation only (no fixtures created/cleaned up here); the
 * full-lifecycle spec already covers create/edit flows once, at desktop
 * size, and there's no need to triple that data churn just to re-check
 * layout at 2 more widths.
 */
// Deterministic French assertions below (getLocale() falls back to the
// browser's Accept-Language, which Playwright's default context does not
// pin to French) — same fix already established for this reason in
// e2e/access-pending.spec.ts.
test.use({ locale: "fr-FR" });
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 800 },
] as const;

const PAGES = [
  "/admin/audit",
  "/admin/audit/liste",
  "/admin/audit/rapports",
  "/admin/audit/nouveau",
  "/admin/audit/devis",
  "/admin/audit/offres",
  "/admin/audit/equipe",
  "/admin/audit/notifications",
  "/admin/audit/parametres",
  "/admin/catalogue",
];

for (const viewport of VIEWPORTS) {
  test.describe(`Responsive — ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const path of PAGES) {
      test(`${path} : pas de débordement horizontal, pas d'erreur console`, async ({ page }) => {
        const { errors } = collectConsoleErrors(page);

        const response = await page.goto(path, { waitUntil: "load" });
        expect(response?.status(), `${path} a répondu avec une erreur HTTP`).toBeLessThan(400);

        // Real overflow check on the rendered layout, not a fixed timeout —
        // load event has already fired, and this reads current computed layout.
        const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflowPx, `${path} déborde horizontalement de ${overflowPx}px en ${viewport.name}`).toBeLessThanOrEqual(1);

        expect(errors, `${path} : erreurs runtime en ${viewport.name} : ${errors.join(" | ")}`).toEqual([]);
      });
    }

    test("navigation sidebar : sections accessibles et boutons cliquables", async ({ page }) => {
      await page.goto("/admin/audit");
      if (viewport.name === "mobile") {
        const hamburger = page.getByRole("button", { name: "Ouvrir le menu" });
        await expect(hamburger).toBeVisible();
        await hamburger.click();
      }
      const auditNavLink = page.getByRole("link", { name: "Tableau de bord", exact: true }).first();
      await expect(auditNavLink).toBeVisible();
      await expect(auditNavLink).toBeEnabled();
    });

    test("formulaire Nouvel audit : champs utilisables sans chevauchement", async ({ page }) => {
      await page.goto("/admin/audit/nouveau");
      const firstName = page.locator("#firstName");
      await expect(firstName).toBeVisible();
      await firstName.fill("Test");
      await expect(firstName).toHaveValue("Test");
      const submit = page.getByRole("button", { name: "Créer le prospect et démarrer l’audit" });
      await expect(submit).toBeVisible();
      await expect(submit).toBeEnabled();
    });
  });
}
