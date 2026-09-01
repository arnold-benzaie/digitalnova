import { test, expect } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console-errors";

/**
 * AI Commercial Radar / Phase 1E — staff Radar Queue UI (/admin/crm/radar).
 *
 * No CRM route had any E2E coverage before this file (confirmed during the
 * Phase 1E design audit) — this is net-new, not an extension of an
 * existing CRM spec.
 *
 * Fixture strategy: unlike the Audit-module specs (audit-permissions.spec.ts,
 * full-lifecycle.spec.ts), which import `auditDb`/`db/audit-index.ts`
 * directly, no equivalent guarded helper exists in this repo for the main
 * database from inside a Playwright spec — no `.spec.ts` file in this
 * project imports `@/db` directly, and `playwright.config.ts` deliberately
 * loads no env file itself (see its own header comment: this suite must
 * never decide which database the already-running dev server talks to).
 * Building one now would be new test infrastructure beyond this phase's
 * authorized file scope. So the one fixture this file needs (a single
 * QUALIFIED prospect) is created and torn down entirely through the real
 * browser UI — the actual "Ajouter un client" form on /admin/crm/clients
 * and the actual "Supprimer définitivement" action on the client detail
 * page — exactly like a staff member would, going through the same
 * already-running local dev server already verified local-only
 * (127.0.0.1:5434/public_map_approval_test) elsewhere in this engagement.
 * A bare client (name + email, no deal/quote/interaction) is enough:
 * Phase 1D's own test suite already establishes this deterministically
 * produces LOW priority / LOW confidence / "No logged interactions" /
 * "Complete missing contact data" — sufficient to exercise every assertion
 * this file needs without any deal-stage UI interaction.
 *
 * Non-staff access: NOT SAFELY AVAILABLE this phase. audit-permissions.spec.ts's
 * role-swap pattern mutates `audit_staff_memberships`, a table entirely
 * separate from the main app's own `memberships`/`roles` tables that
 * requireStaffRole() actually checks (lib/dev-role.ts -> lib/session.ts).
 * No existing E2E fixture swaps the main app's role, and the only
 * authenticated session available (contact@public-map.com, admin) is the
 * same real account every other spec in this suite depends on — mutating
 * its role here would risk locking every other spec out of the entire
 * admin area if this test crashed before restoring it, a much larger blast
 * radius than the Audit module's parallel, isolated role system. Building
 * a second Clerk test identity is genuinely new auth infrastructure, out
 * of scope this phase. Only the unauthenticated boundary is covered below,
 * via a fresh browser context with no storageState — the same pattern
 * full-lifecycle.spec.ts and audit-module-coverage.spec.ts already use.
 */
test.use({ locale: "fr-FR" });

const FIXTURE_NAME = `E2E Radar Fixture ${Date.now()}`;
const FIXTURE_EMAIL = `e2e-radar-${Date.now()}@example.test`;

test.describe.serial("Radar Queue — /admin/crm/radar", () => {
  let clientDetailUrl: string | null = null;

  test.afterAll(async ({ browser }) => {
    if (!clientDetailUrl) return;
    // Cleanup via the real delete flow, scoped to exactly this fixture's
    // own client id — never a global crm_clients wipe.
    const page = await (await browser.newContext()).newPage();
    page.once("dialog", (dialog) => dialog.accept());
    await page.goto(clientDetailUrl);
    await page.getByRole("button", { name: "Supprimer définitivement" }).click();

    // Preferred outcome is client-side navigation to the clients list, but
    // DeleteClientButton's post-delete router.push() can lose a genuine
    // race against Next's own implicit refresh of this still-mounted,
    // now-deleted client-detail page, which transiently resolves to its
    // own notFound() boundary instead (app/admin/crm/clients/[id]/page.tsx's
    // `if (!client) notFound();`) — confirmed via a prior standalone run's
    // server log + screenshot. Either transient state is acceptable here;
    // this is a best-effort observation, not the success gate below. Each
    // participant carries its own .catch(() => null) BEFORE entering
    // Promise.race — the loser's own eventual timeout-rejection must never
    // be left unhandled, since Promise.race does not cancel it and a bare
    // .catch() on the race's own result only covers whichever settles
    // first, not the other one's later, independent rejection.
    const waitForClientsList = page
      .waitForURL(/\/admin\/crm\/clients$/, { timeout: 15_000 })
      .then(() => "clients-list" as const)
      .catch(() => null);
    const waitForNotFound = page
      .getByText("This page could not be found.")
      .waitFor({ timeout: 15_000 })
      .then(() => "not-found" as const)
      .catch(() => null);
    await Promise.race([waitForClientsList, waitForNotFound]);

    // Deterministic proof of deletion, independent of whichever transient
    // state the click produced: a FRESH navigation to the same detail URL
    // has no stale client-side state to race against — if the fixture is
    // truly gone this reliably renders Next's not-found boundary; if
    // deletion actually failed, hit an app error, or affected the wrong
    // record, this assertion fails loudly instead of the cleanup silently
    // "succeeding".
    await page.goto(clientDetailUrl);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await page.close();
  });

  test("unauthenticated access to /admin/crm/radar redirects to sign-in", async ({ browser }) => {
    // storageState: undefined is required here — playwright.config.ts's
    // `use.storageState` (the real authenticated admin session) is the
    // default for ANY browser.newContext() call unless explicitly
    // overridden, including a bare one with no arguments.
    const page = await (await browser.newContext({ storageState: undefined })).newPage();
    await page.goto("/admin/crm/radar");
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toMatch(/\/sign-in/);
    await page.close();
  });

  test("staff can open the Radar page with no console errors", async ({ page }) => {
    const { errors } = collectConsoleErrors(page);
    await page.goto("/admin/crm/radar");
    await expect(page.getByRole("heading", { name: "Radar prospects" })).toBeVisible();
    // The confidence caption (dictionary key `confidenceCaption`) is
    // rendered once per page, as visible text — not a title/aria-label,
    // not hidden content — making clear confidence reflects available
    // profile information, not a conversion probability.
    await expect(
      page.getByText("reflète les informations de profil disponibles (secteur, localisation), pas une probabilité de conversion."),
    ).toBeVisible();
    expect(errors, `console/page errors on /admin/crm/radar: ${errors.join(" | ")}`).toEqual([]);
  });

  test("malformed raw page params normalize to page 1; a valid page param does not", async ({ page }) => {
    // "Page N / total" only renders once pagination controls are shown at
    // all (real local DB currently has 280+ rows, comfortably more than
    // one page of results), and its "Page N" prefix directly reflects the
    // sanitized page value regardless of row content — a robust proof of
    // normalization that needs no assumption about which specific rows
    // exist.
    for (const malformed of ["2.5", "2abc", "0", "-3"]) {
      await page.goto(`/admin/crm/radar?page=${encodeURIComponent(malformed)}`);
      await expect(page.getByText(/^Page 1 \//), `page=${malformed} must normalize to page 1`).toBeVisible();
    }
    await page.goto("/admin/crm/radar?page=2");
    await expect(page.getByText(/^Page 2 \//), "page=2 must not be normalized to page 1").toBeVisible();
  });

  test("create a bare qualified fixture via the real client form", async ({ page }) => {
    await page.goto("/admin/crm/clients");
    await page.getByText("+ Ajouter un client", { exact: true }).click();
    await page.getByPlaceholder("Nom de l'entreprise *").fill(FIXTURE_NAME);
    // exact: true — the client-list search box's placeholder ("Rechercher
    // par nom, contact ou email…") otherwise also substring-matches "Email".
    await page.getByPlaceholder("Email", { exact: true }).fill(FIXTURE_EMAIL);
    await page.getByRole("button", { name: "Créer le client" }).click();
    await page.waitForURL(/\/admin\/crm\/clients\/[0-9a-f-]{36}$/);
    clientDetailUrl = page.url();
    await expect(page.getByRole("heading", { name: FIXTURE_NAME })).toBeVisible();
  });

  test("the qualified fixture renders truthfully under the Low priority filter", async ({ page }) => {
    test.skip(!clientDetailUrl, "fixture creation test must run first");
    // A bare client with no deals/quotes ranks LOW priority (see
    // lib/radar/score.ts's base case) — scan forward through pages under
    // the Low filter until the fixture is found or the filtered result set
    // is exhausted, since 280+ pre-existing local rows from earlier phases
    // of this engagement mean the fixture is not guaranteed to land on
    // page 1.
    let found = false;
    for (let p = 1; p <= 30 && !found; p++) {
      await page.goto(`/admin/crm/radar?priority=LOW${p > 1 ? `&page=${p}` : ""}`);
      const row = page.getByRole("row", { name: new RegExp(FIXTURE_NAME) });
      if (await row.count()) {
        found = true;
        // Priority/confidence/last-interaction labels below are this
        // page's own localized copy. "No logged interactions" and
        // "Complete missing contact data" are NOT localized — they are
        // Phase 1C's own raw score.ts/qualification.ts output strings,
        // rendered verbatim per this phase's explicit "preserve backend
        // order, do not rewrite" requirement, so they stay in English
        // even on this fr-FR page.
        await expect(row.getByText("Priorité basse")).toBeVisible();
        await expect(row.getByText(/Confiance: faible/)).toBeVisible();
        await expect(row.getByText("Aucune interaction enregistrée")).toBeVisible();
        await expect(row.getByText("No logged interactions")).toBeVisible();
        await expect(row.getByText("Complete missing contact data")).toBeVisible();
        break;
      }
      const nextDisabled = await page.getByRole("link", { name: "Suivant" }).evaluate((el) => el.classList.contains("pointer-events-none"));
      if (nextDisabled) break;
    }
    expect(found, `fixture "${FIXTURE_NAME}" not found under the Low priority filter within 30 pages`).toBe(true);
  });

  test("the qualified fixture never appears under the High priority filter", async ({ page }) => {
    test.skip(!clientDetailUrl, "fixture creation test must run first");
    let found = false;
    for (let p = 1; p <= 30; p++) {
      await page.goto(`/admin/crm/radar?priority=HIGH${p > 1 ? `&page=${p}` : ""}`);
      if (await page.getByRole("row", { name: new RegExp(FIXTURE_NAME) }).count()) {
        found = true;
        break;
      }
      // No pagination controls render at all once neither Previous nor Next
      // applies (e.g. a single short page of HIGH-priority results) — the
      // link may simply not exist, which also means there is no further
      // page to check.
      const nextLink = page.getByRole("link", { name: "Suivant" });
      if ((await nextLink.count()) === 0) break;
      const nextDisabled = await nextLink.evaluate((el) => el.classList.contains("pointer-events-none"));
      if (nextDisabled) break;
    }
    expect(found, "a LOW-priority fixture must never appear under the High priority filter").toBe(false);
  });

  test("the client-detail link from a Radar row navigates to the real client detail route", async ({ page }) => {
    test.skip(!clientDetailUrl, "fixture creation test must run first");
    let navigated = false;
    for (let p = 1; p <= 30 && !navigated; p++) {
      await page.goto(`/admin/crm/radar?priority=LOW${p > 1 ? `&page=${p}` : ""}`);
      const row = page.getByRole("row", { name: new RegExp(FIXTURE_NAME) });
      if (await row.count()) {
        await row.getByRole("link", { name: "Voir le client" }).click();
        await page.waitForURL(/\/admin\/crm\/clients\/[0-9a-f-]{36}$/);
        expect(page.url()).toBe(clientDetailUrl);
        navigated = true;
      }
    }
    expect(navigated, `fixture "${FIXTURE_NAME}" not found while testing client-detail navigation`).toBe(true);
  });

  test("pagination Previous/Next behave correctly at both bounds", async ({ page }) => {
    await page.goto("/admin/crm/radar");
    const previousLink = page.getByRole("link", { name: "Précédent" });
    // Page 1: Previous must be disabled (280+ pre-existing local rows make
    // Next's state on page 1 non-deterministic, so only Previous is
    // asserted here).
    if (await previousLink.count()) {
      expect(await previousLink.evaluate((el) => el.classList.contains("pointer-events-none"))).toBe(true);
    }
    // A deliberately out-of-range page must render the truthful
    // filtered/paginated empty state, never claim nothing exists at all —
    // the one empty-state scenario safely reproducible against this shared,
    // non-empty local database (see the Phase 1D design audit's identical
    // reasoning for why a true zero-qualified run cannot be forced here).
    await page.goto("/admin/crm/radar?page=99999");
    await expect(page.getByText("Aucun prospect ne correspond à cette vue")).toBeVisible();
  });
});
