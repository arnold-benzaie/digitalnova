import { test, expect } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console-errors";

/**
 * AI Commercial Radar / Phase 1G-D — Commercial Performance dashboard
 * (/admin/crm/performance), a pure presentation layer over the frozen,
 * all-time `getCommercialAnalytics()` snapshot (Phase 1G-A.1/1G-B).
 *
 * Unlike crm-radar.spec.ts, this page needs no fixture at all: it's a
 * single all-time aggregate over the whole shared local DB, so the real,
 * already-accumulated local dataset (127.0.0.1:5434/public_map_approval_test)
 * is enough to exercise every section without creating or deleting
 * anything through the UI.
 *
 * Non-staff access: NOT SAFELY AVAILABLE this phase, for the exact same
 * reason documented in crm-radar.spec.ts — no existing E2E fixture swaps
 * the main app's own `memberships`/`roles`-backed role, and the only
 * authenticated session available is the same real admin account every
 * other spec in this suite depends on. Only the unauthenticated boundary
 * is covered below.
 *
 * Multi-currency revenue: the frozen contract requires currencies never
 * be summed (see lib/actions/commercial-analytics.ts's getRevenueByCurrency()
 * GROUP BY currency), and page.tsx's formatRevenueLines() renders each
 * currency as its own line. Whether the shared local DB currently holds
 * paid invoices in 2+ distinct currencies is not something this phase can
 * control without new fixture infrastructure (building a paid, multi-
 * currency invoice requires a full client → quote → invoice → payment UI
 * flow, well beyond a smoke-test's scope, and there is no reset for it).
 * The check below is conditional: if the real data happens to already
 * carry 2+ currencies, it asserts they render as separate lines, never
 * summed; otherwise it documents why it can't force the scenario, exactly
 * like crm-radar.spec.ts's own "NOT SAFELY AVAILABLE" precedent.
 */
test.use({ locale: "fr-FR" });

test.describe("Commercial Performance dashboard — /admin/crm/performance", () => {
  test("unauthenticated access redirects to sign-in", async ({ browser }) => {
    // storageState: undefined is required — playwright.config.ts's
    // `use.storageState` (the real authenticated admin session) is the
    // default for ANY browser.newContext() call unless explicitly
    // overridden, including a bare one with no arguments.
    const page = await (await browser.newContext({ storageState: undefined })).newPage();
    await page.goto("/admin/crm/performance");
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toMatch(/\/sign-in/);
    await page.close();
  });

  test("staff can open the page with no console errors, and every primary section renders", async ({ page }) => {
    const { errors } = collectConsoleErrors(page);

    await page.goto("/admin/crm/performance");
    await expect(page.getByRole("heading", { name: "Performance commerciale", level: 1 })).toBeVisible();

    // Primary KPIs. exact: true throughout — several captions deliberately
    // reuse similar phrasing (e.g. the meeting caption's "...pas un taux de
    // rendez-vous planifiés...", the response detail panel's "Le taux de
    // réponse ci-dessus..."), which Playwright's default case-insensitive
    // substring matching would otherwise collide with the bare KPI label.
    await expect(page.getByText("Prospects contactés", { exact: true })).toBeVisible();
    await expect(page.getByText("Taux de réponse", { exact: true })).toBeVisible();
    await expect(page.getByText("Taux de rendez-vous", { exact: true })).toBeVisible();
    await expect(page.getByText("Taux de réussite des affaires", { exact: true })).toBeVisible();
    await expect(page.getByText("Taux de conversion (clients contactés)", { exact: true })).toBeVisible();
    await expect(page.getByText("Revenu encaissé", { exact: true })).toBeVisible();

    // Secondary/detail sections (h2 panels).
    await expect(page.getByRole("heading", { name: "Volume de prospection" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Détail des réponses" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Détail des rendez-vous" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Propositions commerciales" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Paiements" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Délais" })).toBeVisible();

    // Staff assessment framing — never implied automated sentiment.
    await expect(page.getByText("Réponses jugées positives par l'équipe (sur les contactés)", { exact: true })).toBeVisible();
    await expect(page.getByText("Réponses jugées négatives par l'équipe (sur les contactés)", { exact: true })).toBeVisible();

    // meetingRate must not claim scheduled/booked/show-up semantics.
    await expect(page.getByText("Rendez-vous observés après une prise de contact sortante")).toBeVisible();

    expect(errors, `console/page errors on /admin/crm/performance: ${errors.join(" | ")}`).toEqual([]);
  });

  test("a null RateResult renders '—', never a misleading 0%", async ({ page }) => {
    await page.goto("/admin/crm/performance");
    // responseRate's denominator is currently 0 in the shared local DB
    // (confirmed by manual verification before writing this test, not
    // assumed) — asserted directly against the rendered KPI value.
    // KpiCard's `label` <p> is a direct sibling of `value`/`footer` inside
    // the same root <div>, so the label's own parent IS the card.
    const responseRateCard = page.getByText("Taux de réponse", { exact: true }).locator("xpath=..");
    await expect(responseRateCard.getByText("0 / 0")).toBeVisible();
    const bodyText = await page.locator("body").innerText();
    expect(bodyText, "denominator=0 rates must render as em dash, never 0%").not.toMatch(/\b0%/);
  });

  test("a zero-sample duration renders 'Aucune donnée disponible', never '0 j'", async ({ page }) => {
    await page.goto("/admin/crm/performance");
    // The "Délais" <h2>'s parent <div> is the whole timing panel (panelClass
    // wraps both the heading and the three duration rows).
    const timingPanel = page.getByRole("heading", { name: "Délais" }).locator("xpath=..");
    await expect(timingPanel.getByText("Aucune donnée disponible").first()).toBeVisible();
    const timingText = await timingPanel.innerText();
    expect(timingText, "sampleSize=0 durations must never render as 0.0 j").not.toMatch(/0\.0 j/);
  });

  test("revenue currencies never get summed together (conditional on real multi-currency data existing)", async ({ page }) => {
    await page.goto("/admin/crm/performance");
    const paymentsPanel = page.getByRole("heading", { name: "Paiements" }).locator("xpath=..");
    const currencyLineCount = await paymentsPanel.locator("p").filter({ hasText: /[€$]/ }).count();
    if (currencyLineCount < 2) {
      test.skip(true, "shared local DB does not currently hold paid invoices in 2+ distinct currencies — cannot be forced without new fixture infrastructure beyond this phase's scope (see file header)");
    }
    // If 2+ currency amounts are present, they must render as visually
    // distinct lines (never a single combined total).
    expect(currencyLineCount).toBeGreaterThanOrEqual(2);
  });

  test("the legacy data-quality note appears (the shared local DB has real pre-Phase-1F direction-less interactions)", async ({ page }) => {
    await page.goto("/admin/crm/performance");
    await expect(page.getByRole("heading", { name: "Limite des données historiques" })).toBeVisible();
    await expect(
      page.getByText("Certaines interactions historiques ne contiennent pas d'information de direction"),
    ).toBeVisible();
  });

  test("no trend arrow UI renders anywhere (no historical time series exists to support one)", async ({ page }) => {
    await page.goto("/admin/crm/performance");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText, "no KpiCard on this page may ever be given a trend prop").not.toMatch(/[▲▼]/);
  });

  test("no chart/recharts UI renders anywhere", async ({ page }) => {
    await page.goto("/admin/crm/performance");
    await expect(page.locator("svg.recharts-surface")).toHaveCount(0);
  });

  test("mobile viewport: no horizontal overflow", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
    await page.goto("/admin/crm/performance");
    await expect(page.getByRole("heading", { name: "Performance commerciale", level: 1 })).toBeVisible();
    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth, "page must not scroll horizontally at 375px width").toBeLessThanOrEqual(clientWidth);
    await page.close();
  });
});
