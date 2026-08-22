import { test, expect, chromium } from "@playwright/test";
import { Client } from "pg";

// Deterministic French assertions below need a pinned locale, not
// Playwright's default — same fix already established in
// e2e-approval/user-approval.spec.ts and e2e/access-pending.spec.ts.
test.use({ locale: "fr-FR" });

/**
 * Real-browser E2E coverage for the AI Assistant widget (2026-08, Phase
 * 1A). Runs against the dev server playwright.chat.config.ts starts on
 * :3604, with DATABASE_URL pointed at the fully isolated local Docker
 * Postgres (public-map-approval-test-db, :5434 — already migrated for
 * chat_conversations/chat_messages), NEVER Supabase Production/Preview.
 *
 * Anonymous scenarios need no Clerk session at all — /sign-in itself is
 * a public route and the widget mounts there like everywhere else. The
 * one authenticated scenario reuses the same real Clerk Development
 * user (contact@public-map.com) already established by
 * e2e-approval/user-approval.spec.ts, seeding a local `users` row with a
 * distinctive firstName to verify the personalized greeting.
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

async function signInWithTicket(page: import("@playwright/test").Page, token: string, redirectTarget: string) {
  await page.goto(`/sign-in?__clerk_ticket=${token}&redirect_url=${encodeURIComponent(redirectTarget)}`, { waitUntil: "networkidle", timeout: 25_000 });
  await page.waitForURL(new RegExp(redirectTarget.split("?")[0].replace(/\//g, "\\/")), { timeout: 20_000 });
}

let publicMapOrgId: string;
let namedClerkUserId: string;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await db.connect();

  const dbCheck = await db.query("select current_database() as db");
  if (dbCheck.rows[0].db !== "public_map_approval_test") {
    throw new Error(`REFUS : base connectée = "${dbCheck.rows[0].db}", attendu "public_map_approval_test". Arrêt.`);
  }

  const orgRes = await db.query("select id from organizations where name = 'PUBLIC-MAP'");
  if (orgRes.rows.length !== 1) throw new Error("Organisation PUBLIC-MAP introuvable dans la base de test locale.");
  publicMapOrgId = orgRes.rows[0].id;

  const adminUsers = await clerkApi(`/users?email_address=${encodeURIComponent("contact@public-map.com")}`);
  if (!Array.isArray(adminUsers) || adminUsers.length !== 1) {
    throw new Error("Utilisateur Clerk Development contact@public-map.com introuvable — prérequis de e2e/README.md non satisfait.");
  }
  namedClerkUserId = adminUsers[0].id;
  const clientRoleRes = await db.query("select id from roles where name = 'client'");
  const [namedDbUser] = (
    await db.query(
      "insert into users (clerk_user_id, email, full_name, first_name, status) values ($1, $2, $3, $4, 'active') on conflict (clerk_user_id) do update set status = 'active', first_name = $4 returning id",
      [namedClerkUserId, "contact@public-map.com", "Arnold E2E", "Arnold"],
    )
  ).rows;
  await db.query(
    "insert into memberships (user_id, organization_id, role_id) values ($1, $2, $3) on conflict (user_id, organization_id) do nothing",
    [namedDbUser.id, publicMapOrgId, clientRoleRes.rows[0].id],
  );

  // Warm up the two routes this spec visits (dev-mode first-compile).
  const warmupBrowser = await chromium.launch();
  const warmupPage = await warmupBrowser.newPage();
  for (const path of ["/sign-in", "/dashboard"]) {
    await warmupPage.goto(`http://localhost:3604${path}`, { timeout: 60_000 }).catch(() => {});
  }
  await warmupBrowser.close();
});

test.afterAll(async () => {
  await db.end();
});

// ---- widget chrome: visible, opens, closes, minimizes --------------------

test("le widget est visible sur une page publique (sign-in), s'ouvre et se ferme", async ({ page }) => {
  await page.goto("/sign-in");

  const trigger = page.getByRole("button", { name: "Ouvrir l'assistant PUBLIC-MAP" });
  await expect(trigger).toBeVisible();

  await trigger.click();
  await expect(page.getByText("PUBLIC-MAP Assistant")).toBeVisible();
  await expect(page.getByText("En ligne")).toBeVisible();

  await page.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByText("PUBLIC-MAP Assistant")).not.toBeVisible();
  await expect(trigger).toBeVisible();
});

test("le bouton Réduire referme le panneau sans perdre la conversation", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Ouvrir l'assistant PUBLIC-MAP" }).click();
  await page.getByPlaceholder("Écrivez votre message…").fill("Comment fonctionne PUBLIC-MAP ?");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText("PUBLIC-MAP centralise")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Réduire" }).click();
  await expect(page.getByText("PUBLIC-MAP Assistant")).not.toBeVisible();

  await page.getByRole("button", { name: "Ouvrir l'assistant PUBLIC-MAP" }).click();
  await expect(page.getByText("PUBLIC-MAP centralise")).toBeVisible();
});

// ---- welcome bubble --------------------------------------------------

test("la bulle d'accueil apparaît automatiquement après quelques secondes et peut être fermée", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText("Bienvenue chez PUBLIC-MAP")).toBeVisible({ timeout: 6_000 });

  await page.getByRole("button", { name: "Fermer le message d'accueil" }).click();
  await expect(page.getByText("Bienvenue chez PUBLIC-MAP")).not.toBeVisible();
});

// ---- conversation: message, suggestions ------------------------------

test("un message anonyme reçoit une réponse pertinente et des suggestions cliquables", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Ouvrir l'assistant PUBLIC-MAP" }).click();

  await page.getByPlaceholder("Écrivez votre message…").fill("Je veux améliorer mon Google Business Profile.");
  await page.getByRole("button", { name: "Envoyer" }).click();

  await expect(page.getByText("optimisation de votre profil Google Business")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Comment fonctionne PUBLIC-MAP ?" })).toBeVisible();

  await page.getByRole("button", { name: "Comment fonctionne PUBLIC-MAP ?" }).click();
  await expect(page.getByText("PUBLIC-MAP centralise")).toBeVisible({ timeout: 15_000 });
});

// ---- lead capture form -------------------------------------------------

test("demander à parler à quelqu'un affiche le formulaire, exige le consentement, puis confirme l'envoi", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Ouvrir l'assistant PUBLIC-MAP" }).click();

  await page.getByPlaceholder("Écrivez votre message…").fill("Je veux parler à quelqu'un.");
  await page.getByRole("button", { name: "Envoyer" }).click();

  await expect(page.getByText("Laissez-nous vos coordonnées")).toBeVisible({ timeout: 15_000 });

  // exact:true throughout — the Clerk sign-in form underneath (this
  // widget is an overlay, not a page replacement) has its own "Adresse
  // e-mail" field, which getByLabel would otherwise substring-match.
  await page.getByLabel("Nom complet", { exact: true }).fill("Client Test E2E");
  await page.getByLabel("E-mail", { exact: true }).fill(`e2e-${Date.now()}@chat-test.local`);
  await page.getByLabel("Message / besoin", { exact: true }).fill("Besoin d'aide pour démarrer.");

  // The lead form's own "Envoyer" submit button renders BEFORE the chat
  // input's send button in DOM order (the message list, which contains
  // the form, precedes the <form> input bar) — .first() targets the
  // form's button specifically, never the (disabled, empty-draft) input
  // send button.
  const leadFormSubmit = page.getByRole("button", { name: "Envoyer", exact: true }).first();

  // Submit without consent -> blocked, clean validation message, no request.
  await leadFormSubmit.click();
  await expect(page.getByText("Merci d'accepter d'être contacté(e) pour continuer.")).toBeVisible();

  await page.getByText("J'accepte que PUBLIC-MAP me contacte concernant ma demande.").click();
  await leadFormSubmit.click();

  await expect(page.getByText("Votre demande a bien été transmise à PUBLIC-MAP")).toBeVisible({ timeout: 15_000 });
});

// ---- error + retry -----------------------------------------------------

test("une erreur provider affiche un message d'erreur avec un bouton Réessayer fonctionnel", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Ouvrir l'assistant PUBLIC-MAP" }).click();

  await page.getByPlaceholder("Écrivez votre message…").fill("TEST_SIMULATE_PROVIDER_ERROR");
  await page.getByRole("button", { name: "Envoyer" }).click();

  await expect(page.getByText("Une erreur est survenue. Veuillez réessayer.")).toBeVisible({ timeout: 15_000 });
  const retryButton = page.getByRole("button", { name: "Réessayer" });
  await expect(retryButton).toBeVisible();
  await retryButton.click();
  // Same sentinel -> same error again, proving Retry genuinely re-sent
  // the request rather than silently doing nothing.
  await expect(page.getByText("Une erreur est survenue. Veuillez réessayer.")).toBeVisible({ timeout: 15_000 });
});

// ---- FR/EN ---------------------------------------------------------------

test("EN: le widget affiche tous ses textes en anglais quand pm_locale=en", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([{ name: "pm_locale", value: "en", domain: "localhost", path: "/" }]);
  const page = await context.newPage();
  await page.goto("/sign-in");

  const trigger = page.getByRole("button", { name: "Open PUBLIC-MAP assistant" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByText("Online")).toBeVisible();

  await page.getByPlaceholder("Write your message…").fill("I want to launch Google Ads.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("PUBLIC-MAP can help you set up and monitor Google Ads campaigns")).toBeVisible({ timeout: 15_000 });

  await context.close();
});

// ---- authenticated: personalized greeting --------------------------------

test("utilisateur connecté : le message d'accueil personnalisé affiche son prénom", async ({ page }) => {
  const token = await createSignInToken(namedClerkUserId);
  await signInWithTicket(page, token, "/dashboard");

  await page.getByRole("button", { name: "Ouvrir l'assistant PUBLIC-MAP" }).click();
  await expect(page.getByText("Bonjour Arnold")).toBeVisible();
});

// ---- mobile ---------------------------------------------------------------

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("le panneau occupe l'écran en plein (quasi) sans débordement horizontal", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Ouvrir l'assistant PUBLIC-MAP" }).click();
    await expect(page.getByText("PUBLIC-MAP Assistant")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);

    await page.getByPlaceholder("Écrivez votre message…").fill("Bonjour");
    await expect(page.getByPlaceholder("Écrivez votre message…")).toBeVisible();
  });
});
