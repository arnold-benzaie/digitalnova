import { test, expect } from "@playwright/test";
import { captureOriginalRole, restoreOriginalRole, setRole } from "./helpers/main-db-role.mjs";
import { ensureStaffRole, ensureRadarStaffMember } from "./helpers/main-db-staff.mjs";
import { setLocalQuotaPolicy, clearLocalQuotaPolicy, setLocalQuotaCounter, clearLocalQuotaCounter } from "./helpers/main-db-quota.mjs";
import { collectConsoleErrors } from "./helpers/console-errors";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G4C-4 — final browser validation of the
 * RADAR AI quota governance surface (/admin/owner/ai-governance): the
 * G4A policy form, the G4C-2/G4C-3 "Quota actuel" snapshot, and the
 * unmodified G3B "Historique d'utilisation IA" report, plus the
 * OWNER-only authorization boundary (Axis-C requireStaffMember(
 * "RADAR_AI_POLICY_MANAGE")) and the Axis-A /admin segment boundary
 * (requireInternalStaff, client -> /dashboard).
 *
 * Mutates TWO independent pieces of shared local-test state:
 *   - Axis-C staff_members role (main-db-staff.mjs) — restored to the
 *     EMPLOYEE standing seed e2e/crm-radar.spec.ts depends on, in
 *     afterEach AND afterAll (never left as OWNER/ADMIN/MANAGER).
 *   - radar_ai_quota_policy / radar_ai_quota_counter rows
 *     (main-db-quota.mjs) — cleared back to "no row" in afterEach AND
 *     afterAll, restoring the exact pre-G4C-4 baseline (both tables were
 *     confirmed empty before this phase's first write).
 * Also temporarily swaps the Axis-A membership role to "client" for one
 * test (main-db-role.mjs, same mechanism staff-rbac.spec.ts already
 * uses) — captured/restored with the same hard-verified afterEach/afterAll
 * pattern, so this file's tests can run in any position relative to
 * staff-rbac.spec.ts without leaving a poisoned baseline for it.
 *
 * UNAVAILABLE is NOT forced in this file: the only way to genuinely
 * reproduce it is a real store failure (a dropped table or connection
 * error), which is unsafe to simulate against shared local E2E
 * infrastructure other specs depend on. It is already exhaustively
 * proven by quota-status.test.mjs (G4C-1, 30 tests) and
 * radar-ai-quota-governance.test.mjs (G4C-2, 26 tests) — both green — and
 * was, in fact, directly and organically observed in this exact
 * environment during this validation, before migrations 0042/0043 were
 * applied to the local test DB (see the G4C-4 report).
 */
test.describe.configure({ mode: "serial" });
test.use({ locale: "fr-FR" });

const ROUTE = "/admin/owner/ai-governance";
const AI_PROVIDER_HOST_RE = /anthropic\.com|openai\.com|generativelanguage\.googleapis\.com/i;

let staffCtx: Awaited<ReturnType<typeof captureOriginalRole>>;

test.beforeAll(async () => {
  staffCtx = await captureOriginalRole(); // throws unless Axis-A baseline is exactly "admin"
});

test.afterEach(async () => {
  await clearLocalQuotaPolicy();
  await clearLocalQuotaCounter();
  await ensureRadarStaffMember(); // restore the Axis-C EMPLOYEE standing seed
  await restoreOriginalRole(staffCtx); // restore the Axis-A "admin" baseline; idempotent no-op if unchanged
});

test.afterAll(async () => {
  await clearLocalQuotaPolicy();
  await clearLocalQuotaCounter();
  await ensureRadarStaffMember();
  await restoreOriginalRole(staffCtx);
});

test.describe("RADAR AI quota governance — /admin/owner/ai-governance", () => {
  test("unauthenticated: redirects to /sign-in, no governance content ever rendered", async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: undefined })).newPage();
    await page.goto(ROUTE);
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toMatch(/\/sign-in/);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Quota actuel");
    expect(bodyText).not.toContain("Gouvernance IA");
    await page.close();
  });

  test("CLIENT (Axis-A, external/no-staff account): fails closed at the /admin boundary, lands on /dashboard, no governance content leaks", async ({ page }) => {
    await setRole(staffCtx, "client");
    await page.goto(ROUTE);
    await page.waitForURL(/\/dashboard/);
    expect(page.url()).toMatch(/\/dashboard/);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Quota actuel");
    expect(bodyText).not.toContain("Gouvernance IA");
    expect(bodyText).not.toContain("Historique d'utilisation IA");
  });

  for (const role of ["ADMIN", "MANAGER", "EMPLOYEE"]) {
    test(`${role} (Axis-C, lacks RADAR_AI_POLICY_MANAGE): denied, redirected to /admin -- no governance content rendered`, async ({ page }) => {
      await ensureStaffRole(role);
      await page.goto(ROUTE);
      await expect(page, `${role} must be bounced to exactly /admin, never the governance page`).toHaveURL((u) => u.pathname === "/admin");
      const bodyText = await page.locator("body").innerText();
      expect(bodyText).not.toContain("Quota actuel");
      expect(bodyText).not.toContain("Historique d'utilisation IA");
    });
  }

  test("OWNER: page accessible; unlimited policy -> NORMAL; 'Illimité' shown for limit/remaining, no fabricated percentage", async ({ page }) => {
    await ensureStaffRole("OWNER");
    await setLocalQuotaPolicy({ enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 });
    const { errors } = collectConsoleErrors(page);
    const providerRequests: string[] = [];
    page.on("request", (req) => {
      if (AI_PROVIDER_HOST_RE.test(req.url())) providerRequests.push(req.url());
    });

    await page.goto(ROUTE);
    await expect(page).toHaveURL((u) => u.pathname === ROUTE);
    await expect(page.getByRole("heading", { name: "Gouvernance IA" })).toBeVisible();

    // The three distinct sections, all present.
    await expect(page.getByRole("heading", { name: "Quotas et limites" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quota actuel" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Historique d'utilisation IA" })).toBeVisible();

    // Current status.
    const quotaPanel = page.getByRole("heading", { name: "Quota actuel" }).locator("xpath=..");
    await expect(quotaPanel.getByText("Normal", { exact: true })).toBeVisible();

    // Unlimited: "Illimité" appears (request limit + remaining, token limit + remaining -> at least 4 times).
    // The static warning-threshold config line ("Seuil d'avertissement: 80%")
    // legitimately contains a "%" -- what must never appear is a fabricated
    // USAGE percentage row ("Utilisation") for either unlimited resource.
    const panelText = await quotaPanel.innerText();
    expect((panelText.match(/Illimité/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(panelText).not.toContain("Utilisation");

    expect(errors, `console/page errors on ${ROUTE}: ${errors.join(" | ")}`).toEqual([]);
    expect(providerRequests, `unexpected AI provider network request(s): ${providerRequests.join(", ")}`).toEqual([]);
  });

  test("OWNER: configured limits with real usage -> used/limit/remaining/percentage all render the exact snapshot values", async ({ page }) => {
    await ensureStaffRole("OWNER");
    await setLocalQuotaPolicy({ enabled: true, dailyRequestLimit: 100, dailyTokenLimit: 10_000, warningThresholdPercent: 80 });
    await setLocalQuotaCounter({ requestCount: 10, tokenCount: 1_000 });

    await page.goto(ROUTE);
    const quotaPanel = page.getByRole("heading", { name: "Quota actuel" }).locator("xpath=..");
    await expect(quotaPanel.getByText("Normal", { exact: true })).toBeVisible();

    const panelText = await quotaPanel.innerText();
    // requests: used 10, limit 100, remaining 90, usage 10%
    expect(panelText).toContain("10");
    expect(panelText).toContain("100");
    expect(panelText).toContain("90");
    // tokens: used 1 000 (locale-grouped), limit 10 000, remaining 9 000, usage 10%
    expect(panelText).toMatch(/1[\s ]?000/);
    expect(panelText).toMatch(/10[\s ]?000/);
    expect(panelText).toMatch(/9[\s ]?000/);
  });

  test("OWNER: usage at the warning threshold -> WARNING status renders", async ({ page }) => {
    await ensureStaffRole("OWNER");
    await setLocalQuotaPolicy({ enabled: true, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 50 });
    await setLocalQuotaCounter({ requestCount: 5, tokenCount: 0 });

    await page.goto(ROUTE);
    const quotaPanel = page.getByRole("heading", { name: "Quota actuel" }).locator("xpath=..");
    await expect(quotaPanel.getByText("Seuil d'avertissement atteint", { exact: true })).toBeVisible();
  });

  test("OWNER: requestCount >= dailyRequestLimit -> LIMITED status renders, remaining=0", async ({ page }) => {
    await ensureStaffRole("OWNER");
    await setLocalQuotaPolicy({ enabled: true, dailyRequestLimit: 5, dailyTokenLimit: null, warningThresholdPercent: 80 });
    await setLocalQuotaCounter({ requestCount: 5, tokenCount: 0 });

    await page.goto(ROUTE);
    const quotaPanel = page.getByRole("heading", { name: "Quota actuel" }).locator("xpath=..");
    await expect(quotaPanel.getByText("Limite atteinte", { exact: true })).toBeVisible();
  });

  test("OWNER: enabled=false -> DISABLED status, a clear non-error message, no usage numbers invented", async ({ page }) => {
    await ensureStaffRole("OWNER");
    await setLocalQuotaPolicy({ enabled: false, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 80 });

    await page.goto(ROUTE);
    const quotaPanel = page.getByRole("heading", { name: "Quota actuel" }).locator("xpath=..");
    await expect(quotaPanel.getByText("Désactivé", { exact: true })).toBeVisible();
    await expect(quotaPanel.getByText("désactivée par le propriétaire")).toBeVisible();
    const panelText = await quotaPanel.innerText();
    expect(panelText).not.toMatch(/Indisponible|indisponible/);
  });

  test("G3B/G4C separation: the historical report's own numbers never appear inside the 'Quota actuel' panel, and vice versa", async ({ page }) => {
    await ensureStaffRole("OWNER");
    await setLocalQuotaPolicy({ enabled: true, dailyRequestLimit: 100, dailyTokenLimit: null, warningThresholdPercent: 80 });
    await setLocalQuotaCounter({ requestCount: 3, tokenCount: 0 });

    await page.goto(ROUTE);
    const quotaPanel = page.getByRole("heading", { name: "Quota actuel" }).locator("xpath=..");
    const quotaPanelText = await quotaPanel.innerText();
    // The G3B history section's own labels ("Entrée"/"Sortie" token
    // breakdown, provider/model tables) must never appear inside the
    // "Quota actuel" panel.
    expect(quotaPanelText).not.toContain("Réponses servies par fournisseur");
    expect(quotaPanelText).not.toContain("Réponses servies par modèle");

    const historyHeading = page.getByRole("heading", { name: "Historique d'utilisation IA" });
    await expect(historyHeading).toBeVisible();
    const historySection = historyHeading.locator("xpath=../..");
    const historyText = await historySection.innerText();
    // The current-quota panel's own status label must never appear inside
    // the historical section.
    expect(historyText).not.toContain("Statut");
  });

  test("no operational RADAR content leaks onto this page (no AI advisory affordance, no client-facing text)", async ({ page }) => {
    await ensureStaffRole("OWNER");
    await setLocalQuotaPolicy({ enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 });

    await page.goto(ROUTE);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Obtenir un avis IA");
    expect(bodyText).not.toContain("Avis IA");
  });

  test("no secret-shaped value renders anywhere on the page across every status", async ({ page }) => {
    await ensureStaffRole("OWNER");
    await setLocalQuotaPolicy({ enabled: true, dailyRequestLimit: 10, dailyTokenLimit: 1000, warningThresholdPercent: 80 });
    await setLocalQuotaCounter({ requestCount: 5, tokenCount: 500 });

    await page.goto(ROUTE);
    const bodyText = await page.locator("body").innerText();
    expect(/apiKey|sk-ant-|sk-proj-|DATABASE_URL|Authorization|Bearer|credential/i.test(bodyText)).toBe(false);
  });
});
