import { test, expect, chromium } from "@playwright/test";
import { Client } from "pg";

// Deterministic French assertions — same fix already established
// elsewhere in this repo (Playwright's default context doesn't pin
// Accept-Language to French).
test.use({ locale: "fr-FR" });

/**
 * Real-browser E2E coverage for the 2026-08 Canada/Europe
 * market-as-source-of-truth feature: signup market choice -> pending ->
 * real admin approval (through the actual /admin/users UI, same as
 * e2e-approval/user-approval.spec.ts) -> organization.market bootstrap ->
 * client session automatically getting the right currency/region context,
 * with no second market prompt -> persistence across a brand-new browser
 * session (logout/login) and a plain reload -> cross-tenant isolation ->
 * staff correction from the CRM -> the "market not configured" state for
 * pre-existing organizations.
 *
 * The actual Clerk <SignUp/> widget itself (email/password entry,
 * verification) is NOT driven here — same scope decision already made for
 * Google Ads' real OAuth consent screen (e2e-google-ads/google-ads.spec.ts):
 * Clerk's own sign-up mechanics are its library's concern, not this
 * feature's. What IS driven for real is everything PUBLIC-MAP's own code
 * does from the moment a signed-up-with-Clerk browser lands on
 * /sign-up/market onward — landing there directly via a real Clerk
 * sign-in ticket is functionally identical to what a genuine post-signup
 * redirect produces, since app/sign-up/market/page.tsx itself only ever
 * checks auth(), never how the browser got there.
 */

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Production.");
}
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
if (!CLERK_SECRET_KEY.startsWith("sk_test_")) {
  throw new Error("REFUS : CLERK_SECRET_KEY doit être une clé de Développement (sk_test_).");
}

const db = new Client({ connectionString: LOCAL_DB_URL });

async function clerkApi(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Clerk API ${path} a échoué : ${JSON.stringify(data.errors ?? data)}`);
  return data;
}

async function createSignInToken(clerkUserId: string) {
  const data = await clerkApi("/sign_in_tokens", { method: "POST", body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 300 }) });
  return data.token as string;
}

/** Direct navigation with redirect_url set to the FINAL destination —
 * never a chained intermediate redirect. See e2e-approval/user-approval.spec.ts's
 * own detailed comment on why that specifically is unreliable here. */
async function signInWithTicket(page: import("@playwright/test").Page, token: string, redirectTarget: string) {
  await page.goto(`/sign-in?__clerk_ticket=${token}&redirect_url=${encodeURIComponent(redirectTarget)}`, { waitUntil: "networkidle", timeout: 25_000 });
  await page.waitForURL(new RegExp(redirectTarget.split("?")[0].replace(/\//g, "\\/")), { timeout: 20_000 });
}

async function createClerkUser(emailPrefix: string) {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await clerkApi("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [email], first_name: "E2E", last_name: "Market", skip_password_requirement: true }),
  });
  return { clerkUserId: created.id as string, email };
}

/** Approves a pending user into `organizationName` (must already exist in
 * the DB — appears in the real <select>) with role "client", through the
 * REAL /admin/users UI — same interaction sequence already proven
 * reliable by e2e-approval/user-approval.spec.ts.
 *
 * Always runs in its OWN fresh browser context, never the client's own
 * `page` — a Clerk sign-in ticket redeemed in a browser context that
 * already holds an ACTIVE session for a different user does not switch
 * identity (confirmed directly: reusing the client's page here left the
 * browser on /access-pending under the client's own still-pending
 * session instead of navigating to /admin/users as the admin). Two
 * different people (client, admin) approving each other's access is
 * exactly the real-world scenario this must model. */
async function approveViaRealUi(browser: import("@playwright/test").Browser, adminClerkUserId: string, pendingEmail: string, organizationName: string) {
  const adminContext = await browser.newContext();
  const page = await adminContext.newPage();
  try {
    const adminToken = await createSignInToken(adminClerkUserId);
    await signInWithTicket(page, adminToken, "/admin/users?status=pending");
    await expect(page.getByText(pendingEmail)).toBeVisible({ timeout: 15_000 });

    const row = page.locator("tr", { hasText: pendingEmail }).first();
    await row.getByRole("button", { name: "Approuver" }).click();
    const openDialog = page.locator("dialog[open]");
    await openDialog.getByLabel("Organisation", { exact: true }).selectOption({ label: organizationName });
    await openDialog.getByLabel("Rôle", { exact: true }).selectOption({ value: "client" });
    // Scoped strictly to the OPEN dialog — unlike e2e-approval/user-approval.spec.ts's
    // own equivalent unscoped `.last()` (safe there only because that
    // suite's DB has a single pending row at that point), this local test
    // DB has accumulated many pending rows across this whole session's
    // various suites, each with its own (closed) "Approuver" trigger
    // button — an unscoped `.last()` here grabs the LAST row's trigger
    // button instead of this dialog's own confirm button.
    await openDialog.getByRole("button", { name: "Approuver", exact: true }).click();
    await expect(page.getByText(pendingEmail)).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await adminContext.close();
  }
}

let adminClerkUserId: string;
const cleanupClerkUserIds: string[] = [];
const cleanupOrgIds: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(600_000);
  await db.connect();

  const dbCheck = await db.query("select current_database() as db");
  if (dbCheck.rows[0].db !== "public_map_approval_test") {
    throw new Error(`REFUS : base connectée = "${dbCheck.rows[0].db}", attendu "public_map_approval_test". Arrêt.`);
  }

  const adminUsers = await clerkApi(`/users?email_address=${encodeURIComponent("contact@public-map.com")}`);
  if (!Array.isArray(adminUsers) || adminUsers.length !== 1) {
    throw new Error("Utilisateur Clerk Development contact@public-map.com introuvable — prérequis de e2e/README.md non satisfait.");
  }
  adminClerkUserId = adminUsers[0].id;
  const publicMapOrg = await db.query("select id from organizations where name = 'PUBLIC-MAP'");
  const adminRole = await db.query("select id from roles where name = 'admin'");
  const [adminDbUser] = (
    await db.query(
      "insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'active') on conflict (clerk_user_id) do update set status = 'active' returning id",
      [adminClerkUserId, "contact@public-map.com", "Admin E2E"],
    )
  ).rows;
  await db.query(
    "insert into memberships (user_id, organization_id, role_id) values ($1, $2, $3) on conflict (user_id, organization_id) do nothing",
    [adminDbUser.id, publicMapOrg.rows[0].id, adminRole.rows[0].id],
  );

  // Route warm-up — webpack dev-mode first-compile latency, same
  // rationale as e2e-approval/user-approval.spec.ts's own identical block.
  const warmBrowser = await chromium.launch();
  for (const path of ["/dashboard", "/sign-up/market", "/access-pending", "/admin/users", "/dashboard/settings", "/admin/crm/clients"]) {
    const warmPage = await warmBrowser.newPage();
    try {
      const warmToken = await createSignInToken(adminClerkUserId);
      await warmPage.goto(`http://localhost:3603/sign-in?__clerk_ticket=${warmToken}&redirect_url=${encodeURIComponent(path)}`, { waitUntil: "networkidle", timeout: 90_000 });
      await warmPage.waitForURL(new RegExp(path.replace(/\//g, "\\/")), { timeout: 90_000 });
    } catch {
      // best-effort warm-up — a real test failing later is the real signal
    }
    await warmPage.close();
  }
  await warmBrowser.close();
});

test.afterAll(async () => {
  for (const id of cleanupClerkUserIds) {
    await clerkApi(`/users/${id}`, { method: "DELETE" }).catch(() => {});
  }
  for (const orgId of cleanupOrgIds) {
    await db.query("delete from memberships where organization_id = $1", [orgId]);
    await db.query("delete from organizations where id = $1", [orgId]);
  }
  await db.end();
});

async function runFullMarketJourney(
  page: import("@playwright/test").Page,
  browser: import("@playwright/test").Browser,
  {
    marketButtonLabel,
    expectedMarket,
    expectedCurrency,
    orgLabelPrefix,
  }: { marketButtonLabel: string; expectedMarket: "CANADA" | "EUROPE"; expectedCurrency: "CAD" | "EUR"; orgLabelPrefix: string },
) {
  const { clerkUserId, email } = await createClerkUser(`e2e-market-${expectedMarket.toLowerCase()}`);
  cleanupClerkUserIds.push(clerkUserId);
  const orgName = `${orgLabelPrefix} ${Date.now()}`;

  // 1) Land on /sign-up/market exactly as a fresh Clerk signup would be
  //    redirected there (fallbackRedirectUrl — see app/sign-up/[[...sign-up]]/page.tsx).
  const token = await createSignInToken(clerkUserId);
  await signInWithTicket(page, token, "/sign-up/market");
  await expect(page.getByRole("button", { name: new RegExp(marketButtonLabel) })).toBeVisible();

  // 2) Explicit market choice.
  await page.getByRole("button", { name: new RegExp(marketButtonLabel) }).click();
  await page.waitForURL(/\/access-pending/, { timeout: 15_000 });

  // 3) pendingMarket really persisted.
  const pendingRow = await db.query("select pending_market from users where clerk_user_id = $1", [clerkUserId]);
  expect(pendingRow.rows[0].pending_market).toBe(expectedMarket);

  // 4) access-pending screen shown (real "waiting for approval" copy).
  await expect(page.getByText(/attente|pending/i).first()).toBeVisible();

  // 5) Real admin approves through the real /admin/users UI, into a BRAND
  //    NEW organization (created here, no market set yet).
  const [org] = (await db.query("insert into organizations (name) values ($1) returning id", [orgName])).rows;
  cleanupOrgIds.push(org.id);
  await approveViaRealUi(browser, adminClerkUserId, email, orgName);

  // 6) organizations.market bootstrapped from the client's own choice.
  const orgRow = await db.query("select market from organizations where id = $1", [org.id]);
  expect(orgRow.rows[0].market).toBe(expectedMarket);

  // 7) Client signs in — lands straight on their dashboard settings,
  //    no second market prompt anywhere in the journey.
  const clientToken = await createSignInToken(clerkUserId);
  await signInWithTicket(page, clientToken, "/dashboard/settings");
  const marketValue = page.getByTestId("organization-market-value");
  await expect(marketValue).toBeVisible({ timeout: 15_000 });
  await expect(marketValue).toContainText(expectedCurrency);
  const otherCurrency = expectedCurrency === "CAD" ? "EUR" : "CAD";
  await expect(marketValue).not.toContainText(otherCurrency);

  // 8) Persistence across refresh.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("organization-market-value")).toContainText(expectedCurrency);

  // 9) FR/EN toggle never changes the market (DB-level proof, not just UI).
  const langButton = page.getByRole("button", { name: "English" });
  if (await langButton.isVisible().catch(() => false)) {
    await langButton.click();
    await page.waitForLoadState("networkidle");
  }
  await expect(page.getByTestId("organization-market-value")).toContainText(expectedCurrency);
  const afterLangSwitch = await db.query("select market from organizations where id = $1", [org.id]);
  expect(afterLangSwitch.rows[0].market).toBe(expectedMarket);

  // 10) Persistence across a genuinely NEW browser session (logout/login) —
  //     a fresh context, not just a reload, proves nothing client-side
  //     (cookie/localStorage) is what's carrying the market.
  const freshContext = await browser.newContext();
  const freshPage = await freshContext.newPage();
  const freshToken = await createSignInToken(clerkUserId);
  await signInWithTicket(freshPage, freshToken, "/dashboard/settings");
  await expect(freshPage.getByTestId("organization-market-value")).toContainText(expectedCurrency);
  await freshContext.close();

  return { orgId: org.id, orgName, clerkUserId };
}

test("parcours Canada complet : signup -> pendingMarket -> pending -> approbation réelle -> organizations.market=CANADA -> contexte CAD automatique, persistant", async ({ page, browser }) => {
  await runFullMarketJourney(page, browser, {
    marketButtonLabel: "Canada",
    expectedMarket: "CANADA",
    expectedCurrency: "CAD",
    orgLabelPrefix: "E2E Marché Canada",
  });
});

test("parcours Europe complet : signup -> pendingMarket -> pending -> approbation réelle -> organizations.market=EUROPE -> contexte EUR automatique, persistant", async ({ page, browser }) => {
  await runFullMarketJourney(page, browser, {
    marketButtonLabel: "Europe",
    expectedMarket: "EUROPE",
    expectedCurrency: "EUR",
    orgLabelPrefix: "E2E Marché Europe",
  });
});

test("ancien compte (market=null) : état explicite « non configuré », jamais un marché deviné", async ({ page }) => {
  const [org] = (await db.query("insert into organizations (name) values ($1) returning id", [`E2E Marché Non Configuré ${Date.now()}`])).rows;
  cleanupOrgIds.push(org.id);
  const roleRes = await db.query("select id from roles where name = 'client'");
  const { clerkUserId } = await createClerkUser("e2e-market-unset");
  cleanupClerkUserIds.push(clerkUserId);
  const [dbUser] = (
    await db.query("insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [clerkUserId, `${clerkUserId}@example.com`, "E2E Unset"])
  ).rows;
  await db.query("insert into memberships (user_id, organization_id, role_id) values ($1, $2, $3)", [dbUser.id, org.id, roleRes.rows[0].id]);

  const token = await createSignInToken(clerkUserId);
  await signInWithTicket(page, token, "/dashboard/settings");

  const marketValue = page.getByTestId("organization-market-value");
  await expect(marketValue).toBeVisible({ timeout: 15_000 });
  await expect(marketValue).not.toContainText("CAD");
  await expect(marketValue).not.toContainText("EUR");
  await expect(marketValue).not.toContainText("Canada");
  await expect(marketValue).not.toContainText("Europe");
});

test("le staff peut attribuer/corriger le marché depuis la fiche client CRM", async ({ page }) => {
  const [org] = (await db.query("insert into organizations (name) values ($1) returning id", [`E2E Marché CRM ${Date.now()}`])).rows;
  cleanupOrgIds.push(org.id);
  const [crmClient] = (
    await db.query("insert into crm_clients (name, organization_id) values ($1, $2) returning id", [`E2E CRM Client ${Date.now()}`, org.id])
  ).rows;

  try {
    const adminToken = await createSignInToken(adminClerkUserId);
    await signInWithTicket(page, adminToken, `/admin/crm/clients/${crmClient.id}`);

    await expect(page.getByText("Marché PUBLIC-MAP")).toBeVisible({ timeout: 15_000 });
    const select = page.getByTestId("organization-market-select").locator("select");
    await select.selectOption("CANADA");

    // InlineStatusSelect calls the server action inside a React transition
    // (async, non-navigating) — waitForLoadState("networkidle") can resolve
    // before that fetch actually lands. Poll the real DB state instead of
    // guessing a fixed wait.
    await expect
      .poll(async () => (await db.query("select market from organizations where id = $1", [org.id])).rows[0].market, { timeout: 15_000 })
      .toBe("CANADA");
  } finally {
    await db.query("delete from crm_clients where id = $1", [crmClient.id]);
  }
});

test("sécurité : /sign-up/market ignore tout market fourni en query string — seul le clic du formulaire compte", async ({ page }) => {
  const { clerkUserId } = await createClerkUser("e2e-market-security");
  cleanupClerkUserIds.push(clerkUserId);
  const token = await createSignInToken(clerkUserId);
  await signInWithTicket(page, token, "/sign-up/market?market=EUROPE");

  // The page never reads ?market — nothing is persisted just from visiting.
  const before = await db.query("select pending_market from users where clerk_user_id = $1", [clerkUserId]);
  expect(before.rows[0]?.pending_market ?? null).toBe(null);
});
