import { test, expect } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console-errors";
import { ensureRadarStaffMember } from "./helpers/main-db-staff.mjs";
import {
  insertConvertedDiscoveryResult,
  deleteDiscoveryResult,
  deleteCrmClientFixture,
  getFixturePresence,
} from "./helpers/main-db-discovery.mjs";

/**
 * 4F.9-E — browser-level proof of the Radar WEBSITE promotion
 * (lib/radar/priority.ts rule 1, explained in the queue since 4F.9-D):
 * a bare prospect scores basePriority LOW; a linked Discovery row with no
 * website (and no crm_websites row) yields NO_WEBSITE -> WEBSITE, which
 * lifts finalPriority to MEDIUM. The queue then lists it under MEDIUM (never
 * LOW), shows the "Priorité moyenne" badge, and explains the promotion.
 *
 * Fixtures: the prospect is created and claimed through the real UI, exactly
 * like e2e/crm-radar.spec.ts (see that file's header for why this EMPLOYEE
 * account can only open the client page once the prospect is its own). The
 * Discovery row has no UI path in E2E and is written by
 * e2e/helpers/main-db-discovery.mjs (local test DB only).
 *
 * Cleanup (afterAll, runs even after a mid-test failure): the Discovery row
 * by its exact id first, then the client — through the UI when it was
 * claimed, otherwise through the helper's exact id + name fallback — then a
 * DB read proves both are gone.
 */
test.describe.configure({ mode: "serial" });
test.use({ locale: "fr-FR" });

const FIXTURE_STAMP = Date.now();
const FIXTURE_NAME = `E2E Radar Website ${FIXTURE_STAMP}`;
const FIXTURE_EMAIL = `e2e-radar-website-${FIXTURE_STAMP}@example.test`;
const PROMOTION_EXPLANATION = "Relevée depuis « Priorité basse » : aucun site web enregistré";

let clientId: string | null = null;
let discoveryResult: { id: string; sourceId: string } | null = null;
let claimed = false;

function fixtureRow(page: import("@playwright/test").Page) {
  return page.getByRole("row", { name: new RegExp(FIXTURE_NAME) });
}

/**
 * Locates the unclaimed fixture under ?assignee=unassigned&priority=MEDIUM.
 * Within the MEDIUM tier a LOW-based, LOW-confidence, never-contacted,
 * brand-new prospect sorts LAST (lib/actions/radar-queue.ts comparator), so
 * this starts from the last page and scans backward a few pages — the same
 * strategy as e2e/crm-radar.spec.ts's locateUnassignedFixtureRow().
 */
async function locateUnassignedMediumFixtureRow(page: import("@playwright/test").Page) {
  const base = "/admin/crm/radar?assignee=unassigned&priority=MEDIUM";
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Radar prospects" })).toBeVisible();

  const pageOfLocator = page.getByText(/^Page \d+ \/ \d+$/);
  const pageOfText = (await pageOfLocator.count()) ? await pageOfLocator.textContent() : null;
  const match = pageOfText?.match(/^Page (\d+) \/ (\d+)$/);
  const totalPages = match ? Number(match[2]) : 1;

  for (let p = totalPages; p >= Math.max(1, totalPages - 4); p--) {
    await page.goto(`${base}&page=${p}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Radar prospects" })).toBeVisible();
    const candidate = fixtureRow(page);
    if (await candidate.count()) return candidate;
  }
  return null;
}

test.beforeAll(async () => {
  const ensured = await ensureRadarStaffMember();
  expect(ensured.status).toBe("ACTIVE");
  expect(ensured.roleName).toBe("EMPLOYEE");
});

test.afterAll(async ({ browser }) => {
  if (discoveryResult) {
    await deleteDiscoveryResult(discoveryResult);
  }

  if (clientId && claimed) {
    // Same UI deletion as e2e/crm-radar.spec.ts: still self-assigned, so the
    // detail page (and its delete button) is reachable for this account.
    const page = await (await browser.newContext()).newPage();
    page.once("dialog", (dialog) => dialog.accept());
    await page.goto(`/admin/crm/clients/${clientId}`);
    await page.getByRole("button", { name: "Supprimer définitivement" }).click();
    await page
      .waitForURL(/\/admin\/crm\/clients$/, { timeout: 15_000 })
      .catch(() => null);
    await page.close();
  }

  if (clientId) {
    // Fallback for an unclaimed (or UI-undeleted) fixture — exact id + name.
    const presence = await getFixturePresence({ discoveryResultId: null, clientId });
    if (presence.crmClient) await deleteCrmClientFixture({ id: clientId, name: FIXTURE_NAME });
  }

  const after = await getFixturePresence({ discoveryResultId: discoveryResult?.id ?? null, clientId });
  expect(after, "every fixture this spec created must be gone").toEqual({ discoveryResult: 0, crmClient: 0 });
});

test.describe("Radar Queue — WEBSITE promotion LOW -> MEDIUM", () => {
  test("create a bare prospect (no website, no deal/quote) through the real UI", async ({ page }) => {
    await page.goto("/admin/crm/clients");
    await page.getByText("+ Ajouter un client", { exact: true }).click();
    await page.getByPlaceholder("Nom de l'entreprise *").fill(FIXTURE_NAME);
    await page.getByPlaceholder("Email", { exact: true }).fill(FIXTURE_EMAIL);
    await page.getByRole("button", { name: "Créer le client" }).click();

    // createClient()'s router.push() fires only once the Server Action has
    // resolved — the URL carries the new client's id.
    await page.waitForURL(/\/admin\/crm\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    clientId = page.url().match(/\/admin\/crm\/clients\/([0-9a-f-]{36})$/)![1];
  });

  test("link a website-less Discovery row to the prospect", async () => {
    expect(clientId, "prospect creation must have run first").not.toBeNull();
    const inserted = await insertConvertedDiscoveryResult(clientId!, { name: FIXTURE_NAME });
    discoveryResult = inserted;
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("the promoted prospect is listed under priority=MEDIUM and can be claimed", async ({ page }) => {
    const row = await locateUnassignedMediumFixtureRow(page);
    expect(row, `fixture "${FIXTURE_NAME}" must appear under ?assignee=unassigned&priority=MEDIUM`).not.toBeNull();

    const claim = row!.getByRole("button", { name: "Me l'attribuer" });
    await expect(claim).toBeVisible();
    await claim.click();
    await expect(row!, "the fixture must leave the Unassigned view once claimed").toHaveCount(0);
    claimed = true;
  });

  test("under priority=MEDIUM: medium badge + French promotion explanation, no console error", async ({ page }) => {
    const { errors } = collectConsoleErrors(page);
    await page.goto("/admin/crm/radar?assignee=me&priority=MEDIUM", { waitUntil: "networkidle" });

    const row = fixtureRow(page);
    await expect(row, `fixture "${FIXTURE_NAME}" must be listed under ?assignee=me&priority=MEDIUM`).toHaveCount(1);
    await expect(row.getByText("Priorité moyenne", { exact: true })).toBeVisible();
    await expect(row.getByText(PROMOTION_EXPLANATION, { exact: true })).toBeVisible();
    await expect(row.getByText("Priorité basse", { exact: true }), "the badge reads finalPriority, never basePriority").toHaveCount(0);

    expect(errors, `console/page errors on /admin/crm/radar: ${errors.join(" | ")}`).toEqual([]);
  });

  test("the promoted prospect is absent under priority=LOW", async ({ page }) => {
    await page.goto("/admin/crm/radar?assignee=me&priority=LOW", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Radar prospects" })).toBeVisible();
    await expect(fixtureRow(page)).toHaveCount(0);
  });
});
