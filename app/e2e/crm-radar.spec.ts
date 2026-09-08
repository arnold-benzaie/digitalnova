import { test, expect } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console-errors";
import { ensureRadarStaffMember, getRadarStaffMemberSnapshot } from "./helpers/main-db-staff.mjs";

/**
 * AI Commercial Radar — staff Radar Queue UI (/admin/crm/radar).
 *
 * No CRM route had any E2E coverage before this file — it is net-new.
 *
 * Identity (RADAR-E2E-AUTH-1): the one shared Playwright account
 * (contact@public-map.com) holds Axis-A `admin` but, historically, no
 * Axis-C `staff_members` row — so the RADAR mutations gated by
 * requireStaffMember("RADAR_WORK") (claimProspect, createInteraction) all
 * failed closed, and the queue E2E could only ever read. `beforeAll` now
 * calls ensureRadarStaffMember() (e2e/helpers/main-db-staff.mjs): an
 * idempotent, guarded upsert that gives the account an ACTIVE **EMPLOYEE**
 * membership in the internal workspace of the LOCAL disposable test DB
 * (127.0.0.1:5434/public_map_approval_test) only. EMPLOYEE — not ADMIN — so
 * getRadarCapabilities() resolves { canClaimToSelf: true, canAssignOthers:
 * false, canReleaseOwn: true }: the least-privilege identity that can claim
 * its own fixture and still proves the negative (no assign-to-others
 * control). The membership is a PERSISTENT local-test seed — never deleted
 * here — because an ACTIVE Axis-C row changes no Axis-A behaviour (every
 * /admin gate and the queue read are requireStaffRole()/requireInternalStaff()),
 * so no other spec is affected and there is no restore race to lose.
 *
 * Fixture strategy: a single bare prospect CLIENT, created and torn down
 * entirely through the real browser UI ("+ Ajouter un client" on
 * /admin/crm/clients, "Supprimer définitivement" on the client detail
 * page) — this repo exposes no guarded `@/db` handle to a .spec.ts for the
 * prospect itself, and going through the UI exercises the same code a
 * staffer would. A bare client deterministically scores (lib/radar/score.ts):
 * priority LOW, confidence LOW, no interaction — emitted reason
 * [INTERACTION_NONE], recommendedNextAction COMPLETE_CONTACT_DATA. The
 * fixture is then CLAIMED to self through the real "Me l'attribuer" control
 * on its client-detail page, after which `/admin/crm/radar?assignee=me`
 * surfaces it on page 1 regardless of how large the shared local DB has
 * grown or where the bare prospect ranks in the global cohort — the
 * discovery no longer depends on priority, confidence, recency, createdAt
 * tie-breaks, or stale fixtures. This fr-FR spec asserts the RADAR-CORE-3F
 * French copy for that row: reason "Aucune interaction n'est enregistrée"
 * (deliberately distinct from the last-interaction column's "Aucune
 * interaction enregistrée") and next-action "Compléter les coordonnées du
 * prospect".
 *
 * Non-staff / other-role access is still out of scope here (it would need a
 * second Clerk identity or an Axis-A role swap with a much larger blast
 * radius); only the unauthenticated boundary is covered, via a fresh
 * context with no storageState.
 */
test.use({ locale: "fr-FR" });

const FIXTURE_STAMP = Date.now();
const FIXTURE_NAME = `E2E Radar Fixture ${FIXTURE_STAMP}`;
const FIXTURE_EMAIL = `e2e-radar-${FIXTURE_STAMP}@example.test`;

// The fixture's own Radar row, located deterministically under
// ?assignee=me (optionally intersected with another filter). The row's
// accessible name aggregates its cells, so the unique fixture name matches
// exactly one <tr>. Never a cohort page-scan.
function fixtureRow(page: import("@playwright/test").Page) {
  return page.getByRole("row", { name: new RegExp(FIXTURE_NAME) });
}

test.describe.serial("Radar Queue — /admin/crm/radar", () => {
  let clientDetailUrl: string | null = null;

  test.beforeAll(async () => {
    // Idempotent — call it twice and confirm it converges to exactly one
    // ACTIVE EMPLOYEE row (no accumulation), then verify via the read-only
    // snapshot.
    await ensureRadarStaffMember();
    const ensured = await ensureRadarStaffMember();
    expect(ensured.status).toBe("ACTIVE");
    expect(ensured.roleName).toBe("EMPLOYEE");

    const snapshot = await getRadarStaffMemberSnapshot();
    expect(snapshot, "the E2E account must have a staff_members row after ensureRadarStaffMember()").not.toBeNull();
    expect(snapshot!.status).toBe("ACTIVE");
    expect(snapshot!.roleName).toBe("EMPLOYEE");
  });

  test.afterAll(async ({ browser }) => {
    if (!clientDetailUrl) return;
    const page = await (await browser.newContext()).newPage();

    // Best-effort: release our own assignment first, from the ?assignee=me
    // Radar row (where "Retirer" + its confirm dialog are unambiguous —
    // the client-detail page also has billing-line "Retirer" buttons). Not
    // the cleanup gate — deleteClient() drops the crm_clients row outright
    // (lib/actions/crm-clients.ts: plain db.delete(crmClients), no
    // assignment guard; the assigned_user_id FK is ON DELETE SET NULL per
    // migration 0036 / lib/actions/radar-assignment.integration.test.mjs),
    // so the client is removed whether or not it was released — but
    // releasing keeps ?assignee=me clean for the next run even if the
    // delete below ever regresses.
    try {
      await page.goto("/admin/crm/radar?assignee=me");
      const row = fixtureRow(page);
      const release = row.getByRole("button", { name: "Retirer" });
      if (await release.count()) {
        await release.click();
        await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
        await expect(row).toHaveCount(0);
      }
    } catch {
      // fall through to the authoritative delete
    }

    // Cleanup via the real delete flow, scoped to exactly this fixture's
    // own client id — never a global crm_clients wipe, never direct SQL.
    page.once("dialog", (dialog) => dialog.accept());
    await page.goto(clientDetailUrl);
    await page.getByRole("button", { name: "Supprimer définitivement" }).click();

    // DeleteClientButton's post-delete router.push() can lose a race
    // against Next's own implicit refresh of this still-mounted, now-deleted
    // client-detail page, which transiently resolves to its own notFound()
    // boundary instead. Either transient state is acceptable; this is a
    // best-effort observation, not the success gate below. Each participant
    // carries its own .catch(() => null) BEFORE entering Promise.race — the
    // loser's later timeout-rejection must never be left unhandled.
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

    // Deterministic proof of deletion, independent of that transient state:
    // a FRESH navigation to the same detail URL has no stale client-side
    // state to race against — if the fixture is truly gone this renders
    // Next's not-found boundary; if deletion failed or hit the wrong record
    // this assertion fails loudly instead of the cleanup silently
    // "succeeding".
    await page.goto(clientDetailUrl);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await page.close();
  });

  test("unauthenticated access to /admin/crm/radar redirects to sign-in", async ({ browser }) => {
    // storageState: undefined is required — playwright.config.ts's
    // `use.storageState` (the real authenticated admin session) is the
    // default for ANY browser.newContext() call unless explicitly overridden.
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
    // The confidence caption is rendered once per page, as visible text —
    // making clear confidence reflects available profile information, not a
    // conversion probability.
    await expect(
      page.getByText("reflète les informations de profil disponibles (secteur, localisation), pas une probabilité de conversion."),
    ).toBeVisible();
    expect(errors, `console/page errors on /admin/crm/radar: ${errors.join(" | ")}`).toEqual([]);
  });

  test("malformed raw page params normalize to page 1; a valid page param does not", async ({ page }) => {
    // "Page N / total" only renders once pagination controls are shown (the
    // real local DB has hundreds of qualified rows), and its "Page N"
    // prefix directly reflects the sanitized page value regardless of row
    // content.
    for (const malformed of ["2.5", "2abc", "0", "-3"]) {
      await page.goto(`/admin/crm/radar?page=${encodeURIComponent(malformed)}`);
      await expect(page.getByText(/^Page 1 \//), `page=${malformed} must normalize to page 1`).toBeVisible();
    }
    await page.goto("/admin/crm/radar?page=2");
    await expect(page.getByText(/^Page 2 \//), "page=2 must not be normalized to page 1").toBeVisible();
  });

  test("create the bare prospect fixture through the real UI", async ({ page }) => {
    await page.goto("/admin/crm/clients");
    await page.getByText("+ Ajouter un client", { exact: true }).click();
    await page.getByPlaceholder("Nom de l'entreprise *").fill(FIXTURE_NAME);
    // exact: true — the client-list search box's placeholder ("Rechercher
    // par nom, contact ou email…") otherwise also substring-matches "Email".
    await page.getByPlaceholder("Email", { exact: true }).fill(FIXTURE_EMAIL);
    await page.getByRole("button", { name: "Créer le client" }).click();

    // createClient's post-submit router.push() can lose a race against
    // Next's own refresh (the same race afterAll documents for the delete
    // flow), leaving the browser on the still-rendered clients list. Reach
    // the fixture's detail page deterministically via the list's own
    // name/email search filter rather than depending on that redirect.
    await page.waitForURL(/\/admin\/crm\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 }).catch(() => null);
    if (!/\/admin\/crm\/clients\/[0-9a-f-]{36}$/.test(page.url())) {
      await page.goto(`/admin/crm/clients?q=${encodeURIComponent(FIXTURE_NAME)}`);
      await page.getByRole("link", { name: FIXTURE_NAME, exact: true }).click();
      await page.waitForURL(/\/admin\/crm\/clients\/[0-9a-f-]{36}$/);
    }
    clientDetailUrl = page.url();
    await expect(page.getByRole("heading", { name: FIXTURE_NAME })).toBeVisible();
  });

  test("claim the fixture to self through the real 'Me l'attribuer' control", async ({ page }) => {
    // The client-detail page renders the same RadarAssignmentControls as the
    // Radar row (app/admin/crm/clients/[id]/page.tsx). Navigating straight
    // to clientDetailUrl is deterministic — no queue scan needed to reach
    // the claim button while the prospect is still unassigned.
    expect(clientDetailUrl, "fixture creation must have run first").not.toBeNull();
    await page.goto(clientDetailUrl!);

    const claim = page.getByRole("button", { name: "Me l'attribuer" });
    await expect(claim, "EMPLOYEE holds RADAR_WORK -> canClaimToSelf -> claim button renders").toBeVisible();
    await claim.click();

    // claimProspect() + router.refresh(): once the prospect is assigned to
    // us the claim affordance is no longer rendered. (The "assigned to me"
    // side — the row-scoped "Retirer" release button — is asserted in the
    // next test against the ?assignee=me row, where "Retirer" is
    // unambiguous; on this client-detail page several billing-line "Retirer"
    // buttons also exist, so it is not asserted here.)
    await expect(claim, "the claim button must disappear once the prospect is claimed").toHaveCount(0);
  });

  test("the claimed fixture renders its RADAR-CORE-3F French copy under ?assignee=me on page 1", async ({ page }) => {
    await page.goto("/admin/crm/radar?assignee=me");

    const row = fixtureRow(page);
    // Must be on page 1 of the "my prospects" view. toHaveCount polls, so a
    // just-committed claim that needs a beat to propagate is not a flake;
    // count 1 also asserts the unique-name row is unambiguous.
    await expect(row, `fixture "${FIXTURE_NAME}" must be on page 1 of ?assignee=me`).toHaveCount(1);

    // The prospect is assigned to us: the row-scoped release affordance is
    // present ("Retirer" is unambiguous inside a Radar row — no billing
    // forms here). This is the "claimed to self" proof deferred from the
    // previous test.
    await expect(row.getByRole("button", { name: "Retirer" })).toBeVisible();

    // Priority / confidence: this page's own localized copy for a bare
    // prospect (LOW / LOW).
    await expect(row.getByText("Priorité basse")).toBeVisible();
    await expect(row.getByText(/Confiance: faible/)).toBeVisible();

    // RADAR-CORE-3F: the "Pourquoi" reason and "Prochaine étape" next-action
    // are localized through crm.radar.reasons / crm.radar.nextActions from
    // the deterministic semantic codes emitted by lib/radar/score.ts:
    //   INTERACTION_NONE      -> "Aucune interaction n'est enregistrée"
    //   COMPLETE_CONTACT_DATA -> "Compléter les coordonnées du prospect"
    // INTERACTION_NONE's copy is deliberately distinct from the
    // last-interaction column's "Aucune interaction enregistrée".
    await expect(row.getByText("Aucune interaction n'est enregistrée")).toBeVisible();
    await expect(row.getByText("Compléter les coordonnées du prospect")).toBeVisible();
  });

  test("EMPLOYEE least privilege: can release own claim, cannot assign to others", async ({ page }) => {
    await page.goto("/admin/crm/radar?assignee=me");
    const row = fixtureRow(page);
    await expect(row).toHaveCount(1);

    // canClaimToSelf already exercised (the row is claimed) -> the claim
    // affordance is gone and the own-release affordance is present.
    await expect(row.getByRole("button", { name: "Me l'attribuer" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Retirer" })).toBeVisible();

    // canAssignOthers === false -> RadarAssignmentControls renders NO
    // assign / reassign <select> (aria-label crm.radar.assignment.assign /
    // .reassign) anywhere in the row.
    await expect(row.getByRole("combobox", { name: "Attribuer à" })).toHaveCount(0);
    await expect(row.getByRole("combobox", { name: "Réattribuer à" })).toHaveCount(0);
  });

  test("assignee=me composes with the priority filter without any cohort scan", async ({ page }) => {
    // Bare prospect => LOW priority. Intersecting ?assignee=me with the
    // priority filter is deterministic and DB-size-independent because the
    // "my prospects" set is tiny.
    await page.goto("/admin/crm/radar?assignee=me&priority=LOW");
    await expect(
      fixtureRow(page),
      "a LOW-priority claimed fixture must be present under ?assignee=me&priority=LOW",
    ).toHaveCount(1);

    await page.goto("/admin/crm/radar?assignee=me&priority=HIGH");
    await expect(
      fixtureRow(page),
      "a LOW-priority claimed fixture must be absent under ?assignee=me&priority=HIGH",
    ).toHaveCount(0);
  });

  test("the claimed fixture never appears under ?assignee=unassigned", async ({ page }) => {
    // Claimed => categorically excluded from the unassigned set (the filter
    // is assignedUserId === null). A short bounded scan is a sufficient
    // regression smoke check; no deep cohort walk.
    let found = false;
    for (let p = 1; p <= 3; p++) {
      await page.goto(`/admin/crm/radar?assignee=unassigned${p > 1 ? `&page=${p}` : ""}`);
      if (await fixtureRow(page).count()) {
        found = true;
        break;
      }
      const nextLink = page.getByRole("link", { name: "Suivant" });
      if ((await nextLink.count()) === 0) break;
      if (await nextLink.evaluate((el) => el.classList.contains("pointer-events-none"))) break;
    }
    expect(found, "a claimed prospect must never appear under the Unassigned filter").toBe(false);
  });

  test("the client-detail link from the Radar row navigates to the real client detail route", async ({ page }) => {
    await page.goto("/admin/crm/radar?assignee=me");
    const row = fixtureRow(page);
    await expect(row).toHaveCount(1);
    await row.getByRole("link", { name: "Voir le client" }).click();
    await page.waitForURL(/\/admin\/crm\/clients\/[0-9a-f-]{36}$/);
    expect(page.url()).toBe(clientDetailUrl);
  });

  test("pagination Previous/Next behave correctly at both bounds", async ({ page }) => {
    await page.goto("/admin/crm/radar");
    const previousLink = page.getByRole("link", { name: "Précédent" });
    // Page 1: Previous must be disabled (hundreds of pre-existing local rows
    // make Next's state on page 1 non-deterministic, so only Previous is
    // asserted here).
    if (await previousLink.count()) {
      expect(await previousLink.evaluate((el) => el.classList.contains("pointer-events-none"))).toBe(true);
    }
    // A deliberately out-of-range page must render the truthful
    // filtered/paginated empty state, never claim nothing exists at all —
    // the one empty-state scenario safely reproducible against this shared,
    // non-empty local database.
    await page.goto("/admin/crm/radar?page=99999");
    await expect(page.getByText("Aucun prospect ne correspond à cette vue")).toBeVisible();
  });
});
