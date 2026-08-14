import { test, expect } from "@playwright/test";
import { withDb, createOrgAndClientUser, seedGoogleAdsConnection, cleanupOrg, LOCAL_DB_URL } from "./db-fixtures.mjs";

// Deterministic French assertions — same fix already established
// elsewhere in this repo for this exact reason (Playwright's default
// context doesn't pin Accept-Language to French).
test.use({ locale: "fr-FR" });

/**
 * Real-browser E2E coverage for the Google Ads integration's full client
 * journey: connect -> account discovery -> selection -> dashboard ->
 * period change -> account change -> disconnect, plus the main error
 * states. Runs against the dev server playwright.google-ads.config.ts
 * starts on :3602, DATABASE_URL pointed at the fully isolated local
 * Docker Postgres (public-map-approval-test-db) — never Supabase
 * Production — and real Clerk Development sign-in tokens — never Clerk
 * Production. The actual Google OAuth consent screen is never driven by
 * this suite (Playwright cannot do that safely/reliably); the Google Ads
 * REST API itself is replaced by e2e-google-ads/mock-google-ads-server.mjs
 * via GOOGLE_ADS_API_BASE_URL_OVERRIDE — see that file and
 * lib/google-ads/client.ts's own docstring.
 */

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
if (!CLERK_SECRET_KEY.startsWith("sk_test_")) {
  throw new Error("REFUS : CLERK_SECRET_KEY doit être une clé de Développement (sk_test_).");
}
const MOCK_SERVER_URL = "http://localhost:4010";

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

/** Direct navigation with `redirect_url` set to the FINAL destination —
 * never a chained intermediate redirect (see e2e-approval/user-approval.spec.ts's
 * own detailed comment on why that specifically is unreliable in this
 * project's build). */
async function signInAndGoTo(page: import("@playwright/test").Page, token: string, destination: string) {
  await page.goto(`/sign-in?__clerk_ticket=${token}&redirect_url=${encodeURIComponent(destination)}`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForURL((url) => url.pathname === destination.split("?")[0], { timeout: 30000 });
}

async function setMockState(body: Record<string, unknown>) {
  const res = await fetch(`${MOCK_SERVER_URL}/__control__/state`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Échec de configuration du mock Google Ads server : ${res.status}`);
}

const ONE_ACCOUNT_STATE = {
  accessibleCustomers: ["1112223333"],
  search: {
    "1112223333::customer_client": [
      { customerClient: { clientCustomer: "customers/1112223333", level: "0", manager: false, status: "ENABLED", descriptiveName: "Compte E2E Fixture", currencyCode: "EUR", timeZone: "Europe/Paris" } },
    ],
    "1112223333::summary": [{ metrics: { impressions: "1000", clicks: "50", costMicros: "5000000", ctr: 0.05, averageCpc: "100000", conversions: 4, conversionsValue: 200 } }],
    "1112223333::campaigns": [
      {
        campaign: { id: "555", name: "Campagne Printemps E2E", status: "ENABLED", advertisingChannelType: "SEARCH" },
        campaignBudget: { amountMicros: "20000000" },
        metrics: { impressions: "1000", clicks: "50", costMicros: "5000000", ctr: 0.05, averageCpc: "100000", conversions: 4 },
      },
    ],
  },
  errors: {},
};

// Two independent top-level (non-manager) accounts with genuinely
// different currencies/time zones and distinct, unambiguous monetary
// values — used to verify the currency shown always comes from the
// SELECTED account's own Google Ads data (never derived from the
// client's country, never converted), and that switching accounts never
// leaves a stale currency/value from the previous one on screen.
const CURRENCY_SWITCH_STATE = {
  accessibleCustomers: ["4001112222", "4003334444"],
  search: {
    "4001112222::customer_client": [
      { customerClient: { clientCustomer: "customers/4001112222", level: "0", manager: false, status: "ENABLED", descriptiveName: "Compte Devise EUR", currencyCode: "EUR", timeZone: "Europe/Paris" } },
    ],
    "4003334444::customer_client": [
      { customerClient: { clientCustomer: "customers/4003334444", level: "0", manager: false, status: "ENABLED", descriptiveName: "Compte Devise CAD", currencyCode: "CAD", timeZone: "America/Toronto" } },
    ],
    "4001112222::summary": [{ metrics: { impressions: "10000", clicks: "500", costMicros: "150000000", ctr: 0.05, averageCpc: "300000", conversions: 20, conversionsValue: 4000 } }],
    "4001112222::campaigns": [
      { campaign: { id: "701", name: "Campagne EUR", status: "ENABLED", advertisingChannelType: "SEARCH" }, campaignBudget: { amountMicros: "5000000" }, metrics: { impressions: "10000", clicks: "500", costMicros: "150000000", ctr: 0.05, averageCpc: "300000", conversions: 20 } },
    ],
    "4003334444::summary": [{ metrics: { impressions: "8000", clicks: "400", costMicros: "98000000", ctr: 0.05, averageCpc: "250000", conversions: 15, conversionsValue: 3200 } }],
    "4003334444::campaigns": [
      { campaign: { id: "702", name: "Campagne CAD", status: "ENABLED", advertisingChannelType: "SEARCH" }, campaignBudget: { amountMicros: "4000000" }, metrics: { impressions: "8000", clicks: "400", costMicros: "98000000", ctr: 0.05, averageCpc: "250000", conversions: 15 } },
    ],
  },
  errors: {},
};

const TWO_ACCOUNTS_STATE = {
  accessibleCustomers: ["9998887777"],
  search: {
    "9998887777::customer_client": [
      { customerClient: { clientCustomer: "customers/9998887777", level: "0", manager: true, status: "ENABLED", descriptiveName: "Agence MCC E2E" } },
      { customerClient: { clientCustomer: "customers/1010101010", level: "1", manager: false, status: "ENABLED", descriptiveName: "Compte E2E A", currencyCode: "EUR", timeZone: "Europe/Paris" } },
      { customerClient: { clientCustomer: "customers/2020202020", level: "1", manager: false, status: "ENABLED", descriptiveName: "Compte E2E B", currencyCode: "USD", timeZone: "America/New_York" } },
    ],
  },
  errors: {},
};

test.describe("Google Ads — parcours client complet (mocks contrôlés)", () => {
  let clerkUserId: string;
  let organizationId: string;
  let userId: string;
  const email = `e2e-google-ads-${Date.now()}@example.com`;

  test.beforeAll(async () => {
    const created = await clerkApi("/users", {
      method: "POST",
      body: JSON.stringify({ email_address: [email], first_name: "E2E", last_name: "GoogleAds", skip_password_requirement: true }),
    });
    clerkUserId = created.id;
    await withDb(async (db) => {
      const { org, user } = await createOrgAndClientUser(db, clerkUserId, email);
      organizationId = org.id;
      userId = user.id;
    });
  });

  test.afterAll(async () => {
    await withDb((db) => cleanupOrg(db, organizationId));
    if (clerkUserId) await clerkApi(`/users/${clerkUserId}`, { method: "DELETE" }).catch(() => {});
  });

  test("état non connecté : le bouton Connecter Google Ads redirige vers le vrai écran de consentement Google", async ({ page }) => {
    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");

    await expect(page.getByText("Connecter Google Ads")).toBeVisible();
    const [popupOrNav] = await Promise.all([
      page.waitForNavigation({ waitUntil: "commit" }).catch(() => null),
      page.getByRole("link", { name: "Connecter Google Ads" }).click(),
    ]);
    void popupOrNav;
    await expect(page).toHaveURL(/accounts\.google\.com/, { timeout: 15000 });
  });

  test("connexion déjà établie (fixture), 1 seul compte accessible : sélection puis dashboard de performance", async ({ page }) => {
    await setMockState(ONE_ACCOUNT_STATE);
    await withDb((db) => seedGoogleAdsConnection(db, { organizationId, connectedByUserId: userId }));

    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");

    await expect(page.getByText("Choisissez le compte Google Ads à afficher")).toBeVisible();
    await expect(page.getByText("Compte E2E Fixture")).toBeVisible();

    await page.getByText("Compte E2E Fixture").click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Campagne Printemps E2E")).toBeVisible();
    await expect(page.getByText("Impressions").first()).toBeVisible();
    await expect(page.getByText("1 000").first()).toBeVisible(); // impressions summary tile, fr-FR grouping
  });

  test("changement de période met à jour l'URL et réaffiche le dashboard", async ({ page }) => {
    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");
    await expect(page.getByText("Campagne Printemps E2E")).toBeVisible();

    await page.getByRole("link", { name: "7 derniers jours" }).click();
    await expect(page).toHaveURL(/range=LAST_7_DAYS/);
    await expect(page.getByText("Campagne Printemps E2E")).toBeVisible();
  });

  test("changer de compte revient à l'étape de sélection sans perdre la connexion Google", async ({ page }) => {
    await setMockState(TWO_ACCOUNTS_STATE);
    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");

    await page.getByRole("button", { name: "Changer de compte" }).click();
    await expect(page.getByText("Choisissez le compte Google Ads à afficher")).toBeVisible();
    await expect(page.getByText("Compte E2E A")).toBeVisible();
    await expect(page.getByText("Compte E2E B")).toBeVisible();
    // The manager account itself must never appear as a selectable option.
    await expect(page.getByText("Agence MCC E2E")).toHaveCount(0);

    await page.getByText("Compte E2E A").click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Compte E2E A", { exact: false })).toBeVisible();
  });

  test("déconnexion réutilise le dialogue de confirmation partagé de PUBLIC-MAP — annuler conserve la connexion, confirmer déconnecte", async ({ page }) => {
    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");

    await page.getByRole("button", { name: "Déconnecter" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Déconnecter Google Ads ?")).toBeVisible();

    // Cancel — connection must survive.
    await dialog.getByRole("button", { name: "Annuler" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByText("Compte E2E A", { exact: false })).toBeVisible();

    // Confirm — connection is really removed.
    await page.getByRole("button", { name: "Déconnecter" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Déconnecter", exact: true }).last().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Connecter Google Ads")).toBeVisible();

    const { rows } = await withDb((db) => db.query("select id from google_ads_connections where organization_id = $1", [organizationId]));
    expect(rows.length).toBe(0);
  });

  test("aucun compte Google Ads accessible : message clair, pas de plantage", async ({ page }) => {
    await setMockState({ accessibleCustomers: [], search: {}, errors: {} });
    await withDb((db) => seedGoogleAdsConnection(db, { organizationId, connectedByUserId: userId }));

    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");

    await expect(page.getByText("Aucun compte Google Ads accessible")).toBeVisible();
  });

  test("erreur Google Ads lors de la découverte des comptes : message propre, jamais de texte technique brut", async ({ page }) => {
    await setMockState({
      accessibleCustomers: ["1112223333"],
      search: {},
      errors: { "1112223333::customer_client": { status: 500, message: "Internal error occurred while processing request." } },
    });

    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");

    await expect(page.getByText("Aucun compte Google Ads accessible")).toBeVisible();
    await expect(page.getByText(/Internal error/i)).toHaveCount(0);
    await expect(page.getByText(/INTERNAL/)).toHaveCount(0);
  });

  test("erreur Google Ads lors de la récupération du rapport : message propre, jamais de texte technique brut", async ({ page }) => {
    await withDb((db) => db.query("delete from google_ads_connections where organization_id = $1", [organizationId]));
    await setMockState(ONE_ACCOUNT_STATE);
    await withDb((db) => seedGoogleAdsConnection(db, { organizationId, connectedByUserId: userId, customerId: "1112223333" }));
    await setMockState({
      ...ONE_ACCOUNT_STATE,
      errors: { "1112223333::summary": { status: 503, message: "The service is currently unavailable." } },
    });

    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");

    await expect(page.getByText("Impossible de récupérer les données Google Ads")).toBeVisible();
    await expect(page.getByText(/currently unavailable/i)).toHaveCount(0);
  });

  test("consentement Google refusé (?googleAds=denied) : bandeau clair, aucune connexion créée", async ({ page }) => {
    await withDb((db) => db.query("delete from google_ads_connections where organization_id = $1", [organizationId]));
    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads?googleAds=denied");
    await expect(page.getByText("Connexion annulée — aucune autorisation n'a été accordée.")).toBeVisible();
  });

  test("état d'erreur OAuth (?googleAds=error&reason=invalid_state) : message français traduit, jamais le code brut affiché seul", async ({ page }) => {
    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads?googleAds=error&reason=invalid_state");
    await expect(page.getByText("La demande de connexion a expiré ou est invalide")).toBeVisible();
  });

  test("changement de compte EUR -> CAD : toutes les valeurs et libellés monétaires suivent le compte sélectionné, sans fuite de l'ancienne devise", async ({ page }) => {
    await withDb((db) => db.query("delete from google_ads_connections where organization_id = $1", [organizationId]));
    await setMockState(CURRENCY_SWITCH_STATE);
    await withDb((db) => seedGoogleAdsConnection(db, { organizationId, connectedByUserId: userId }));

    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");

    // Select the EUR account first.
    await expect(page.getByText("Choisissez le compte Google Ads à afficher")).toBeVisible();
    await page.getByText("Compte Devise EUR").click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Europe/Paris", { exact: false })).toBeVisible();
    await expect(page.getByText("150,00 EUR", { exact: false }).first()).toBeVisible(); // coût
    await expect(page.getByText("0,30 EUR", { exact: false }).first()).toBeVisible(); // CPC moyen
    // Aucune trace de CAD tant que le compte EUR est sélectionné.
    await expect(page.getByText(/CAD/)).toHaveCount(0);

    // Switch to the CAD (Toronto) account — same organization, no reconnection.
    await page.getByRole("button", { name: "Changer de compte" }).click();
    await expect(page.getByText("Choisissez le compte Google Ads à afficher")).toBeVisible();
    await page.getByText("Compte Devise CAD").click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("America/Toronto", { exact: false })).toBeVisible();
    await expect(page.getByText("98,00 CAD", { exact: false }).first()).toBeVisible(); // coût
    await expect(page.getByText("0,25 CAD", { exact: false }).first()).toBeVisible(); // CPC moyen
    await expect(page.getByText("Campagne CAD")).toBeVisible();
    // No leftover EUR value/label from the previously selected account.
    await expect(page.getByText(/EUR/)).toHaveCount(0);
    await expect(page.getByText("Campagne EUR")).toHaveCount(0);
    await expect(page.getByText("150,00", { exact: false })).toHaveCount(0);
  });

  test("compte mémorisé devenu inaccessible (403 PERMISSION_DENIED) : retour propre à la sélection, jamais un message d'erreur mort", async ({ page }) => {
    await withDb((db) => db.query("delete from google_ads_connections where organization_id = $1", [organizationId]));
    await setMockState(ONE_ACCOUNT_STATE);
    await withDb((db) => seedGoogleAdsConnection(db, { organizationId, connectedByUserId: userId, customerId: "1112223333" }));

    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");
    await expect(page.getByText("Campagne Printemps E2E")).toBeVisible();

    await setMockState({
      ...ONE_ACCOUNT_STATE,
      errors: { "1112223333::summary": { status: 403, message: "The caller does not have permission.", googleErrorStatus: "PERMISSION_DENIED" } },
    });
    await page.reload();

    await expect(page.getByText("Le compte Google Ads précédemment sélectionné n'est plus accessible")).toBeVisible();
    await expect(page.getByText("Choisissez le compte Google Ads à afficher")).toBeVisible();
    await expect(page.getByText("Impossible de récupérer les données Google Ads")).toHaveCount(0);

    const { rows } = await withDb((db) => db.query("select customer_id, refresh_token_ciphertext from google_ads_connections where organization_id = $1", [organizationId]));
    expect(rows[0].customer_id).toBeNull();
    expect(rows[0].refresh_token_ciphertext).toBeTruthy(); // OAuth grant survives — only the selection is cleared
  });

  test("erreur transitoire (503) sur le compte mémorisé : ne touche PAS à la sélection, message générique réessayable", async ({ page }) => {
    await withDb((db) => db.query("delete from google_ads_connections where organization_id = $1", [organizationId]));
    await setMockState(ONE_ACCOUNT_STATE);
    await withDb((db) => seedGoogleAdsConnection(db, { organizationId, connectedByUserId: userId, customerId: "1112223333" }));
    await setMockState({
      ...ONE_ACCOUNT_STATE,
      errors: { "1112223333::summary": { status: 503, message: "The service is currently unavailable." } },
    });

    const token = await createSignInToken(clerkUserId);
    await signInAndGoTo(page, token, "/dashboard/google-ads");

    await expect(page.getByText("Impossible de récupérer les données Google Ads")).toBeVisible();

    const { rows } = await withDb((db) => db.query("select customer_id from google_ads_connections where organization_id = $1", [organizationId]));
    expect(rows[0].customer_id).toBe("1112223333");
  });
});

void LOCAL_DB_URL; // imported for its module-load-time Production guard side effect
