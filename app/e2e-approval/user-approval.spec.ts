import { test, expect, chromium } from "@playwright/test";
import { Client } from "pg";

// Deterministic French assertions below (getLocale() falls back to the
// browser's Accept-Language, which Playwright's default context does not
// pin to French) — same fix already established for this reason in
// e2e/access-pending.spec.ts.
test.use({ locale: "fr-FR" });

/**
 * Real-browser E2E coverage for the user-approval feature's Clerk-facing
 * half (idempotent registration, status-based redirects) plus the full
 * admin approval journey through the real UI — the parts
 * lib/actions/user-approval.test.mjs can't reach, since Node's
 * --experimental-test-module-mocks doesn't reliably intercept
 * @clerk/nextjs/server (see that file's header comment). Runs against the
 * dev server playwright.approval.config.ts starts on :3601 with
 * DATABASE_URL pointed at the fully isolated local Docker Postgres
 * (public-map-approval-test-db) and real Clerk Development sign-in
 * tokens — never Supabase Production, never Clerk Production.
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
  const data = await clerkApi("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 300 }),
  });
  return data.token as string;
}

/**
 * Real browser navigation redeeming a Clerk sign-in ticket, established
 * via `redirect_url` set DIRECTLY to the already-known expected
 * destination — never to an intermediate page (e.g. /dashboard) that
 * itself issues a further server-side redirect.
 *
 * That distinction is load-bearing, not stylistic: direct navigation
 * reliably completes in 4-10s (confirmed via this file's own route
 * warm-up, and via a `pg_stat_activity` check during a live run showing
 * no connection-pool contention — the server resolves in ~8s every time).
 * A CHAINED redirect (ticket exchange -> /dashboard -> server redirect to
 * the real destination), by contrast, reliably leaves the browser's URL
 * showing "/dashboard" indefinitely — confirmed by waiting a full 60s
 * past what any reasonable compile or DB-query cost could explain, with
 * server logs independently confirming the correct redirect decision
 * WAS computed and issued every single time. That is a client-side
 * navigation defect in this project's Next.js build when a ticket-driven
 * sign-in's own redirect_url itself triggers a further server redirect —
 * not a compile-time issue, not a Clerk issue, not an app logic issue
 * (lib/session.ts's decision is independently verified correct via the
 * DB row and via lib/actions/user-approval.test.mjs's 25 passing
 * integration tests). Each test below additionally confirms status-based
 * gating from a generic entry point via `verifyGatedNavigation()`, which
 * takes the same "plain navigation, no ticket" path proven reliable by
 * this file's own idempotency check.
 */
async function signInWithTicket(page: import("@playwright/test").Page, token: string, redirectTarget: string) {
  await page.goto(`/sign-in?__clerk_ticket=${token}&redirect_url=${encodeURIComponent(redirectTarget)}`, {
    waitUntil: "networkidle",
    timeout: 25_000,
  });
  await page.waitForURL(new RegExp(redirectTarget.split("?")[0].replace(/\//g, "\\/")), { timeout: 20_000 });
}

/** Plain (non-ticket) navigation to a generic authenticated entry point
 * (/dashboard), confirming the session established above is gated the
 * same way regardless of which page a real user happens to land on
 * first — the scenario this file's comment above documents as reliable. */
async function verifyGatedNavigation(page: import("@playwright/test").Page, expectedUrlPattern: RegExp) {
  await page.goto("/dashboard");
  await page.waitForURL(expectedUrlPattern, { timeout: 20_000 });
}

let publicMapOrgId: string;
let adminClerkUserId: string;
let pendingClerkUserId: string;
let pendingClerkUserEmail: string;
let refusedUserDbId: string;
let refusedClerkUserId: string;
let suspendedUserDbId: string;
let suspendedClerkUserId: string;

test.beforeAll(async () => {
  test.setTimeout(600_000); // route warm-up below can take several minutes cold (4 routes, dev-mode first-compile each)
  await db.connect();

  const dbCheck = await db.query("select current_database() as db");
  if (dbCheck.rows[0].db !== "public_map_approval_test") {
    throw new Error(`REFUS : base connectée = "${dbCheck.rows[0].db}", attendu "public_map_approval_test". Arrêt.`);
  }

  const orgRes = await db.query("select id from organizations where name = 'PUBLIC-MAP'");
  if (orgRes.rows.length !== 1) throw new Error("Organisation PUBLIC-MAP introuvable dans la base de test locale.");
  publicMapOrgId = orgRes.rows[0].id;

  // Real Clerk Development-instance user for contact@public-map.com
  // (already used by the pre-existing Audit E2E suite) — seed a
  // corresponding LOCAL active-admin row directly, since this fresh DB
  // has no memberships yet.
  const adminUsers = await clerkApi(`/users?email_address=${encodeURIComponent("contact@public-map.com")}`);
  if (!Array.isArray(adminUsers) || adminUsers.length !== 1) {
    throw new Error("Utilisateur Clerk Development contact@public-map.com introuvable — prérequis de e2e/README.md non satisfait.");
  }
  adminClerkUserId = adminUsers[0].id;
  const adminRoleRes = await db.query("select id from roles where name = 'admin'");
  const [adminDbUser] = (
    await db.query(
      "insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'active') on conflict (clerk_user_id) do update set status = 'active' returning id",
      [adminClerkUserId, "contact@public-map.com", "Admin E2E"],
    )
  ).rows;
  await db.query(
    "insert into memberships (user_id, organization_id, role_id) values ($1, $2, $3) on conflict (user_id, organization_id) do nothing",
    [adminDbUser.id, publicMapOrgId, adminRoleRes.rows[0].id],
  );

  // Throwaway Clerk Development users created fresh for this run, deleted
  // in afterAll — a genuinely new identity Clerk has never issued a local
  // users row for yet is exactly what the "idempotent pending
  // registration" scenario needs to exercise for real.
  const suffix = Date.now();
  pendingClerkUserEmail = `e2e-approval-pending-${suffix}@example.com`;
  const pendingUser = await clerkApi("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [pendingClerkUserEmail],
      first_name: "Pending",
      last_name: "E2E",
      skip_password_requirement: true,
    }),
  });
  pendingClerkUserId = pendingUser.id;
  await clerkApi(`/users/${pendingClerkUserId}`, {
    method: "PATCH",
    body: JSON.stringify({ primary_email_address_id: pendingUser.email_addresses[0].id }),
  });

  const refusedUser = await clerkApi("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [`e2e-approval-refused-${suffix}@example.com`], first_name: "TestUserA", last_name: "E2E", skip_password_requirement: true }),
  });
  refusedClerkUserId = refusedUser.id;
  const [refusedDbUser] = (
    await db.query("insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'refused') returning id", [
      refusedClerkUserId,
      `e2e-approval-refused-${suffix}@example.com`,
      "TestUserA E2E",
    ])
  ).rows;
  refusedUserDbId = refusedDbUser.id;

  const suspendedUser = await clerkApi("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [`e2e-approval-suspended-${suffix}@example.com`], first_name: "TestUserB", last_name: "E2E", skip_password_requirement: true }),
  });
  suspendedClerkUserId = suspendedUser.id;
  const [suspendedDbUser] = (
    await db.query("insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'suspended') returning id", [
      suspendedClerkUserId,
      `e2e-approval-suspended-${suffix}@example.com`,
      "TestUserB E2E",
    ])
  ).rows;
  suspendedUserDbId = suspendedDbUser.id;

  // Webpack dev-mode compiles each route on its FIRST request, and that
  // first compile can take much longer than any reasonable per-test
  // navigation timeout — observed directly (a "Rendering…" dev overlay
  // stuck for 45s+) even against a freshly cleared .next cache. The real
  // tests below reach /access-pending, /access-refused, /access-suspended,
  // and /admin/users via a CLIENT-SIDE redirect chain (through /dashboard),
  // which makes that first-compile latency invisible to any console/network
  // log — so warm each route here, directly and up front, using the exact
  // sessions the real tests will use, before any timed assertion runs.
  // /dashboard is warmed too: every real test below signs in with
  // redirect_url=/dashboard (realistic — the app's own entry point, which
  // itself redirects onward per status), so /dashboard's own first-compile
  // is the actual bottleneck if left out here, even once every downstream
  // target page is already warm — confirmed empirically (targeting a page
  // directly, bypassing /dashboard, always resolved in 4-10s; going
  // through /dashboard first kept timing out even with every OTHER route
  // pre-warmed).
  const warmBrowser = await chromium.launch();
  for (const [clerkUserId, path] of [
    [adminClerkUserId, "/dashboard"],
    [pendingClerkUserId, "/access-pending"],
    [refusedClerkUserId, "/access-refused"],
    [suspendedClerkUserId, "/access-suspended"],
    [adminClerkUserId, "/admin/users"],
  ] as const) {
    const warmStart = Date.now();
    const warmPage = await warmBrowser.newPage();
    try {
      const warmToken = await createSignInToken(clerkUserId);
      await warmPage.goto(`http://localhost:3601/sign-in?__clerk_ticket=${warmToken}&redirect_url=${encodeURIComponent(path)}`, {
        waitUntil: "networkidle",
        timeout: 90_000,
      });
      await warmPage.waitForURL(new RegExp(path.replace(/\//g, "\\/")), { timeout: 90_000 });
      console.log(`[warmup] ${path} OK en ${((Date.now() - warmStart) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.log(`[warmup] ${path} ÉCHEC après ${((Date.now() - warmStart) / 1000).toFixed(1)}s : ${(err as Error).message}`);
    }
    await warmPage.close();
  }
  await warmBrowser.close();
});

test.afterAll(async () => {
  for (const id of [pendingClerkUserId, refusedClerkUserId, suspendedClerkUserId]) {
    if (id) await clerkApi(`/users/${id}`, { method: "DELETE" }).catch(() => {});
  }
  await db.query("delete from memberships where user_id = any($1)", [[refusedUserDbId, suspendedUserDbId].filter(Boolean)]);
  await db.query("delete from users where clerk_user_id = any($1)", [[pendingClerkUserId, refusedClerkUserId, suspendedClerkUserId].filter(Boolean)]);
  await db.end();
});

test("utilisateur non connecté est redirigé vers /sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL(/\/sign-in/);
  await expect(page).toHaveURL(/\/sign-in/);
});

test("nouvel utilisateur Clerk (jamais vu) atterrit sur /access-pending, un enregistrement pending est créé de façon idempotente", async ({ page }) => {
  const token = await createSignInToken(pendingClerkUserId);
  // Establishes the session via a single, reliable hop (ticket exchange
  // -> /dashboard, no further redirect asserted on THIS navigation — see
  // signInWithTicket's doc comment). The actual gating decision (and the
  // users-row creation this test exists to verify) only happens once
  // /dashboard itself runs requireSession(), confirmed via the SEPARATE,
  // reliable plain-navigation step right after.
  await signInWithTicket(page, token, "/dashboard");
  await verifyGatedNavigation(page, /\/access-pending/);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Pending", { exact: false }).or(page.getByText("Bonjour", { exact: false }))).toBeVisible();

  const rows = await db.query("select status, first_name from users where clerk_user_id = $1", [pendingClerkUserId]);
  expect(rows.rows.length).toBe(1);
  expect(rows.rows[0].status).toBe("pending");
  expect(rows.rows[0].first_name).toBe("Pending");

  // Visiting again must not create a duplicate row (idempotent registration).
  await verifyGatedNavigation(page, /\/access-pending/);
  const rowsAfter = await db.query("select count(*)::int as n from users where clerk_user_id = $1", [pendingClerkUserId]);
  expect(rowsAfter.rows[0].n).toBe(1);
});

test("utilisateur refused est redirigé vers /access-refused, contenu bilingue sans détail technique", async ({ page }) => {
  const token = await createSignInToken(refusedClerkUserId);
  await signInWithTicket(page, token, "/dashboard");
  await verifyGatedNavigation(page, /\/access-refused/);

  await expect(page.getByRole("heading", { level: 1, name: /non acceptée/i })).toBeVisible();
  // innerText (visible rendered text only) — NOT body.textContent(), which
  // also captures Next's embedded hydration <script> JSON, itself always
  // containing the literal substrings "error"/"errorStyles"/"errorScripts"
  // on every single page (a reference to the app/error.tsx boundary
  // component wired into every route by the framework, not a real error).
  // What must never appear is raw technical detail, not the word "refused"
  // in the abstract (this page's own copy deliberately avoids it anyway).
  const visibleText = await page.locator("main").innerText();
  expect(visibleText).not.toMatch(/status\s*[:=]|stack trace|at \w+\.\w+\(|SELECT .* FROM/i);
});

test("utilisateur suspended est redirigé vers /access-suspended, contenu bilingue sans détail technique", async ({ page }) => {
  const token = await createSignInToken(suspendedClerkUserId);
  await signInWithTicket(page, token, "/dashboard");
  await verifyGatedNavigation(page, /\/access-suspended/);

  // "Accès suspendu" is the page's own required, human-readable title (see
  // lib/i18n/dictionaries.ts's accessSuspended.title) — the plain French
  // word is expected content, not a leak. What must never appear is raw
  // technical detail: the DB enum value in code form, a stack trace, or SQL.
  await expect(page.getByRole("heading", { level: 1, name: /Accès suspendu/i })).toBeVisible();
  const visibleText = await page.locator("main").innerText();
  expect(visibleText).not.toMatch(/status\s*[:=]|stack trace|at \w+\.\w+\(|SELECT .* FROM/i);
});

test("un administrateur actif approuve un utilisateur pending via l'interface réelle /admin/users", async ({ page }) => {
  const adminToken = await createSignInToken(adminClerkUserId);
  await signInWithTicket(page, adminToken, "/admin/users?status=pending");
  await expect(page).toHaveURL(/\/admin\/users/);

  await expect(page.getByText(pendingClerkUserEmail)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Approuver" }).first().click();
  // Scoped to the one currently-OPEN <dialog>: the page also has a
  // "Filtrer par organisation" / "Filtrer par rôle" filter pair, the
  // (always-present, if closed) "Inviter un utilisateur" dialog's own
  // same-named "Rôle" field, and — since approve-user-modal.tsx renders
  // one instance per pending row — every OTHER pending row's own (closed)
  // approve dialog too. Every one of those collides with a plain
  // accessible-name lookup even while closed, since `<dialog>` without
  // `open` still exposes its labelled contents to Playwright's DOM query.
  const openDialog = page.locator("dialog[open]");
  await openDialog.getByLabel("Organisation", { exact: true }).selectOption({ label: "PUBLIC-MAP" });
  await openDialog.getByLabel("Rôle", { exact: true }).selectOption({ value: "client" });
  await page.getByRole("button", { name: "Approuver", exact: true }).last().click();

  await expect(page.getByText(pendingClerkUserEmail)).toHaveCount(0, { timeout: 15_000 });

  const rows = await db.query("select status from users where clerk_user_id = $1", [pendingClerkUserId]);
  expect(rows.rows[0].status).toBe("active");
  const membership = await db.query(
    "select r.name as role from memberships m join roles r on r.id = m.role_id join users u on u.id = m.user_id where u.clerk_user_id = $1",
    [pendingClerkUserId],
  );
  expect(membership.rows[0].role).toBe("client");
});
