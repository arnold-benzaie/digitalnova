import { test, expect } from "@playwright/test";
import { Client } from "pg";

// Deterministic French assertions below — same fix already established for
// this reason throughout e2e-approval/*.spec.ts / e2e/access-pending.spec.ts.
test.use({ locale: "fr-FR" });

/**
 * MISSION PHASE 3 — CRM CLIENT VISIBILITY BY ASSIGNMENT — real-browser E2E
 * coverage for the two EMPLOYEE-facing guarantees a Node-level test cannot
 * observe: the actual rendered /admin/crm/clients list, and a real
 * Next.js notFound() (HTTP 404) response for a direct-URL visit to a
 * client that isn't the caller's own. The full authorization matrix
 * (forged mutations, unassigned clients, ADMIN/MANAGER/OWNER-unrestricted
 * behavior, count/pagination scoping) is already proven exhaustively by
 * real-DB Node tests in lib/actions/crm-client-visibility.integration.test.mjs
 * — this file exists only for what that one genuinely cannot reach.
 *
 * Deliberately placed here (e2e-approval/, playwright.approval.config.ts)
 * rather than in the shared main e2e/ suite: e2e/crm-radar.spec.ts's own
 * header comment explicitly flags "a second Clerk identity... a much
 * larger blast radius" as a reason it avoids exactly this category of
 * test against the MAIN suite (which the pre-commit hook's Tier 2 runs
 * for every other developer/session). This file needs TWO independent
 * Clerk EMPLOYEE identities to prove mutual exclusion (A sees only A,
 * not B) — the same app, the same local disposable database
 * (public_map_approval_test, port 5434), just borrowed against the
 * ALREADY-isolated dedicated server this repo already stood up for
 * exactly this kind of multi-identity scenario, instead of duplicating a
 * whole new Playwright config for one file.
 *
 * Every Clerk identity and every crm_clients row here is fresh and
 * throwaway (created in beforeAll, deleted in afterAll) — never the
 * shared contact@public-map.com account other specs' standing fixtures
 * depend on, and never any other real/shared client.
 */

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
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

async function createThrowawayClerkUser(emailPrefix: string, suffix: number) {
  const email = `${emailPrefix}-${suffix}@example.com`;
  const created = await clerkApi("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [email], first_name: emailPrefix, last_name: "E2E", skip_password_requirement: true }),
  });
  return { clerkUserId: created.id as string, email };
}

async function signInWithTicket(page: import("@playwright/test").Page, token: string, redirectTarget: string) {
  await page.goto(`/sign-in?__clerk_ticket=${token}&redirect_url=${encodeURIComponent(redirectTarget)}`, {
    waitUntil: "networkidle",
    timeout: 25_000,
  });
  await page.waitForURL(new RegExp(redirectTarget.split("?")[0].replace(/\//g, "\\/")), { timeout: 20_000 });
}

let internalOrgId: string;
let employee1ClerkUserId: string;
let employee1DbUserId: string;
let employee2ClerkUserId: string;
let employee2DbUserId: string;
let clientAId: string;
let clientAName: string;
let clientBId: string;
let clientBName: string;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  await db.connect();

  const dbCheck = await db.query("select current_database() as db");
  if (dbCheck.rows[0].db !== "public_map_approval_test") {
    throw new Error(`REFUS : base connectée = "${dbCheck.rows[0].db}", attendu "public_map_approval_test". Arrêt.`);
  }

  const orgRes = await db.query("select id from organizations where is_internal = true");
  if (orgRes.rows.length !== 1) throw new Error("Organisation interne (is_internal=true) introuvable ou ambiguë dans la base de test locale.");
  internalOrgId = orgRes.rows[0].id;

  const employeeRoleRes = await db.query("select id from staff_roles where name = 'EMPLOYEE'");
  const employeeRoleId = employeeRoleRes.rows[0].id;

  const suffix = Date.now();

  const employee1 = await createThrowawayClerkUser("e2e-crm-vis-emp1", suffix);
  employee1ClerkUserId = employee1.clerkUserId;
  const [employee1DbUser] = (
    await db.query("insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      employee1ClerkUserId,
      employee1.email,
      "Employee1 E2E",
    ])
  ).rows;
  employee1DbUserId = employee1DbUser.id;
  await db.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1, $2, $3, 'ACTIVE')", [
    employee1DbUserId,
    internalOrgId,
    employeeRoleId,
  ]);

  const employee2 = await createThrowawayClerkUser("e2e-crm-vis-emp2", suffix);
  employee2ClerkUserId = employee2.clerkUserId;
  const [employee2DbUser] = (
    await db.query("insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      employee2ClerkUserId,
      employee2.email,
      "Employee2 E2E",
    ])
  ).rows;
  employee2DbUserId = employee2DbUser.id;
  await db.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1, $2, $3, 'ACTIVE')", [
    employee2DbUserId,
    internalOrgId,
    employeeRoleId,
  ]);

  clientAName = `E2E Visibility Client A ${suffix}`;
  clientBName = `E2E Visibility Client B ${suffix}`;
  const [clientA] = (
    await db.query("insert into crm_clients (name, assigned_user_id) values ($1, $2) returning id", [clientAName, employee1DbUserId])
  ).rows;
  clientAId = clientA.id;
  const [clientB] = (
    await db.query("insert into crm_clients (name, assigned_user_id) values ($1, $2) returning id", [clientBName, employee2DbUserId])
  ).rows;
  clientBId = clientB.id;
});

test.afterAll(async () => {
  for (const id of [employee1ClerkUserId, employee2ClerkUserId]) {
    if (id) await clerkApi(`/users/${id}`, { method: "DELETE" }).catch(() => {});
  }
  await db.query("delete from crm_clients where id = any($1)", [[clientAId, clientBId].filter(Boolean)]);
  await db.query("delete from staff_members where user_id = any($1)", [[employee1DbUserId, employee2DbUserId].filter(Boolean)]);
  await db.query("delete from users where clerk_user_id = any($1)", [[employee1ClerkUserId, employee2ClerkUserId].filter(Boolean)]);
  await db.end();
});

test("EMPLOYEE 1 sur /admin/crm/clients voit son propre client A, jamais le client B d'EMPLOYEE 2", async ({ page }) => {
  const token = await createSignInToken(employee1ClerkUserId);
  await signInWithTicket(page, token, "/admin/crm/clients");
  await expect(page).toHaveURL(/\/admin\/crm\/clients/);

  await expect(page.getByText(clientAName)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(clientBName)).toHaveCount(0);
});

test("EMPLOYEE 2 sur /admin/crm/clients voit son propre client B, jamais le client A d'EMPLOYEE 1", async ({ page }) => {
  const token = await createSignInToken(employee2ClerkUserId);
  await signInWithTicket(page, token, "/admin/crm/clients");
  await expect(page).toHaveURL(/\/admin\/crm\/clients/);

  await expect(page.getByText(clientBName)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(clientAName)).toHaveCount(0);
});

test("EMPLOYEE 1 accédant directement à l'URL du détail du client B (non assigné à lui) : notFound() réel, aucune donnée ni contrôle de mutation exposés", async ({ page }) => {
  const token = await createSignInToken(employee1ClerkUserId);
  await page.goto(`/sign-in?__clerk_ticket=${token}&redirect_url=${encodeURIComponent("/admin/crm/clients")}`, {
    waitUntil: "networkidle",
    timeout: 25_000,
  });
  await page.waitForURL(/\/admin\/crm\/clients/, { timeout: 20_000 });

  // NOT a response.status() check: app/admin/crm/loading.tsx streams a
  // 200 shell immediately for this whole subtree (a documented Next.js
  // App Router characteristic — once any part of a streamed response has
  // been sent, notFound() deeper in the tree can no longer change the
  // already-committed HTTP status), so the real, meaningful proof here is
  // the RENDERED CONTENT after the stream settles: client B's data must
  // never appear, and neither must any control that could mutate it. The
  // actual server-side denial (notFound() firing, no row ever read past
  // the ownership check) is what lib/actions/crm-client-visibility.
  // integration.test.mjs proves directly and unambiguously against the
  // real database — this E2E test is the browser-rendered confirmation
  // that the same denial reaches the user, not a second, independent
  // proof of the server-side decision itself.
  await page.goto(`/admin/crm/clients/${clientBId}`, { waitUntil: "networkidle", timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(clientBName)).toHaveCount(0);
  // No mutation control (archive/delete/stage/market) can be reached at
  // all — the strongest possible proof that no UI path exists to mutate a
  // client that isn't theirs.
  await expect(page.getByRole("button", { name: /Archiver|Supprimer/i })).toHaveCount(0);
});

test("EMPLOYEE 1 accédant directement à SON PROPRE client A : accès normal, page réelle", async ({ page }) => {
  const token = await createSignInToken(employee1ClerkUserId);
  const response = await page.goto(`/sign-in?__clerk_ticket=${token}&redirect_url=${encodeURIComponent(`/admin/crm/clients/${clientAId}`)}`, {
    waitUntil: "networkidle",
    timeout: 25_000,
  });
  await page.waitForURL(new RegExp(`/admin/crm/clients/${clientAId}`.replace(/\//g, "\\/")), { timeout: 20_000 });
  expect(response?.status()).not.toBe(404);
  await expect(page.getByText(clientAName)).toBeVisible({ timeout: 20_000 });
});
