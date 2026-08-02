import { test, expect, chromium } from "@playwright/test";
import { Client } from "pg";

// Same fix as user-approval.spec.ts and e2e/access-pending.spec.ts — French
// assertions below need a pinned locale, not the Playwright default.
test.use({ locale: "fr-FR" });

/**
 * Real-browser coverage for the notification-system feature's two personal
 * (per-user, not per-organization) notification types — "user.approved_
 * self" and "user.refused_self" (lib/i18n/notification-templates.ts) —
 * added to lib/actions/users.ts's approveUser()/refuseUser(). Reuses the
 * SAME isolated infrastructure as e2e-approval/user-approval.spec.ts
 * (public-map-approval-test-db on :5434, playwright.approval.config.ts,
 * real Clerk Development sign-in tokens) rather than a second, parallel
 * Docker container/Playwright config — this file just adds to that
 * directory's existing testDir glob, no new config needed. Deliberately a
 * separate file/fixtures from that spec rather than editing it directly,
 * so this addition can never destabilize its already-passing assertions.
 *
 * What this actually verifies, that no other test in this codebase does:
 * the notifications.userId column (see db/schema.ts) genuinely isolates a
 * personal notification from the rest of its organization — before that
 * column existed, "compte approuvé" would have been visible to every
 * member of the org the approved user joined, not just that one person.
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

// Same direct-destination navigation technique (and the same reasoning)
// as e2e-approval/user-approval.spec.ts's signInWithTicket() — a redirect
// chain through an intermediate page is unreliable in this project's dev
// build, a plain direct redirect_url is not.
async function signInWithTicket(page: import("@playwright/test").Page, token: string, redirectTarget: string) {
  await page.goto(`/sign-in?__clerk_ticket=${token}&redirect_url=${encodeURIComponent(redirectTarget)}`, { waitUntil: "networkidle", timeout: 25_000 });
  await page.waitForURL(new RegExp(redirectTarget.split("?")[0].replace(/\//g, "\\/")), { timeout: 20_000 });
}

let publicMapOrgId: string;
let adminClerkUserId: string;
let approvedClerkUserId: string;
let approvedClerkUserEmail: string;
let refusedClerkUserId: string;
let refusedClerkUserEmail: string;

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
    throw new Error("Utilisateur Clerk Development contact@public-map.com introuvable.");
  }
  adminClerkUserId = adminUsers[0].id;
  const adminRoleRes = await db.query("select id from roles where name = 'admin'");
  const [adminDbUser] = (
    await db.query(
      "insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'active') on conflict (clerk_user_id) do update set status = 'active' returning id",
      [adminClerkUserId, "contact@public-map.com", "Admin E2E"],
    )
  ).rows;
  await db.query("insert into memberships (user_id, organization_id, role_id) values ($1, $2, $3) on conflict (user_id, organization_id) do nothing", [
    adminDbUser.id,
    publicMapOrgId,
    adminRoleRes.rows[0].id,
  ]);

  const suffix = Date.now();
  approvedClerkUserEmail = `e2e-notif-approved-${suffix}@example.com`;
  const approvedUser = await clerkApi("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [approvedClerkUserEmail], first_name: "NotifApproved", last_name: "E2E", skip_password_requirement: true }),
  });
  approvedClerkUserId = approvedUser.id;
  await clerkApi(`/users/${approvedClerkUserId}`, { method: "PATCH", body: JSON.stringify({ primary_email_address_id: approvedUser.email_addresses[0].id }) });

  refusedClerkUserEmail = `e2e-notif-refused-${suffix}@example.com`;
  const refusedUser = await clerkApi("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [refusedClerkUserEmail], first_name: "NotifRefused", last_name: "E2E", skip_password_requirement: true }),
  });
  refusedClerkUserId = refusedUser.id;
  await clerkApi(`/users/${refusedClerkUserId}`, { method: "PATCH", body: JSON.stringify({ primary_email_address_id: refusedUser.email_addresses[0].id }) });

  // Same webpack-dev-mode first-compile warm-up rationale as user-approval.
  // spec.ts's own beforeAll — every route a real test below will land on,
  // hit once up front with the exact sessions the tests use.
  const warmBrowser = await chromium.launch();
  for (const [clerkUserId, path] of [
    [adminClerkUserId, "/dashboard"],
    [adminClerkUserId, "/admin/users"],
    [adminClerkUserId, "/admin/notifications"],
    [approvedClerkUserId, "/access-pending"],
    [refusedClerkUserId, "/access-pending"],
  ] as const) {
    const warmPage = await warmBrowser.newPage();
    try {
      const warmToken = await createSignInToken(clerkUserId);
      await warmPage.goto(`http://localhost:3601/sign-in?__clerk_ticket=${warmToken}&redirect_url=${encodeURIComponent(path)}`, {
        waitUntil: "networkidle",
        timeout: 90_000,
      });
      await warmPage.waitForURL(new RegExp(path.replace(/\//g, "\\/")), { timeout: 90_000 });
    } catch (err) {
      console.log(`[warmup] ${path} échec : ${(err as Error).message}`);
    }
    await warmPage.close();
  }
  await warmBrowser.close();
});

test.afterAll(async () => {
  for (const id of [approvedClerkUserId, refusedClerkUserId]) {
    if (id) await clerkApi(`/users/${id}`, { method: "DELETE" }).catch(() => {});
  }
  await db.query("delete from notifications where user_id in (select id from users where clerk_user_id = any($1))", [
    [approvedClerkUserId, refusedClerkUserId],
  ]);
  await db.query("delete from memberships where user_id in (select id from users where clerk_user_id = any($1))", [
    [approvedClerkUserId, refusedClerkUserId],
  ]);
  await db.query("delete from users where clerk_user_id = any($1)", [[approvedClerkUserId, refusedClerkUserId]]);
  await db.end();
});

test("approbation : notification personnelle créée pour l'utilisateur approuvé, invisible pour le reste de l'organisation", async ({ browser }) => {
  // A separate, isolated browser context PER IDENTITY — not the same page
  // reused across sign-ins. Clerk silently drops a sign-in ticket when the
  // browser already has a different active session (same caveat already
  // documented elsewhere in this codebase, e.g. the invitation-acceptance
  // flow) — reusing one page/context to switch from admin to a different
  // user mid-test leaves the browser on the FIRST identity's session
  // instead of actually switching, which is exactly what a naive version
  // of this test silently did.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminToken = await createSignInToken(adminClerkUserId);
  await signInWithTicket(adminPage, adminToken, "/admin/users?status=pending");
  await expect(adminPage.getByText(approvedClerkUserEmail)).toBeVisible({ timeout: 15_000 });

  await adminPage.getByRole("row", { name: new RegExp(approvedClerkUserEmail) }).getByRole("button", { name: "Approuver" }).click();
  const openDialog = adminPage.locator("dialog[open]");
  await openDialog.getByLabel("Organisation", { exact: true }).selectOption({ label: "PUBLIC-MAP" });
  await openDialog.getByLabel("Rôle", { exact: true }).selectOption({ value: "client" });
  // Scoped to the open dialog, not a page-wide "last 'Approuver' button" —
  // with a SECOND pending row also present on this page (refusedClerkUser,
  // approved by the other test in this file), there are 3 "Approuver"-
  // labeled buttons at this point (2 row triggers + this dialog's own
  // submit), and DOM order doesn't reliably put the submit button last.
  await openDialog.getByRole("button", { name: "Approuver", exact: true }).click();
  await expect(adminPage.getByText(approvedClerkUserEmail)).toHaveCount(0, { timeout: 15_000 });

  const approvedDbUser = await db.query("select id from users where clerk_user_id = $1", [approvedClerkUserId]);
  const approvedUserId = approvedDbUser.rows[0].id;

  // The personal row exists, correctly scoped.
  const personalRow = await db.query("select type, user_id, organization_id from notifications where type = 'user.approved_self' and user_id = $1", [
    approvedUserId,
  ]);
  expect(personalRow.rows.length).toBe(1);
  expect(personalRow.rows[0].organization_id).toBe(publicMapOrgId);

  // The real isolation guarantee, verified live through the actual UI (not
  // just by inspecting the query shape): the admin shares this row's
  // organization_id — before the userId column existed, a broadcast query
  // would have shown this to them too — but their own bell/notifications
  // query (visibleToViewer() in lib/actions/notifications.ts) must never
  // surface someone else's personal notification.
  await adminPage.goto("/admin/notifications", { waitUntil: "networkidle" });
  const adminVisibleText = await adminPage.locator("main").innerText();
  expect(adminVisibleText).not.toContain("Votre compte est actif");
  await adminContext.close();

  // The approved user's own session, in its OWN context, DOES see it.
  const approvedContext = await browser.newContext();
  const approvedPage = await approvedContext.newPage();
  const approvedToken = await createSignInToken(approvedClerkUserId);
  await signInWithTicket(approvedPage, approvedToken, "/dashboard/notifications");
  const ownVisibleText = await approvedPage.locator("main").innerText();
  expect(ownVisibleText).toContain("Votre compte est actif");
  await approvedContext.close();
});

test("refus : notification personnelle créée pour l'utilisateur refusé, livrée via un toast unique sur /access-refused", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminToken = await createSignInToken(adminClerkUserId);
  await signInWithTicket(adminPage, adminToken, "/admin/users?status=pending");
  await expect(adminPage.getByText(refusedClerkUserEmail)).toBeVisible({ timeout: 15_000 });

  adminPage.once("dialog", (dialog) => dialog.accept());
  await adminPage.getByRole("row", { name: new RegExp(refusedClerkUserEmail) }).getByRole("button", { name: "Refuser" }).click();
  await expect(adminPage.getByText(refusedClerkUserEmail)).toHaveCount(0, { timeout: 15_000 });
  await adminContext.close();

  const refusedDbUser = await db.query("select id from users where clerk_user_id = $1", [refusedClerkUserId]);
  const refusedUserId = refusedDbUser.rows[0].id;
  const personalRow = await db.query("select type, user_id from notifications where type = 'user.refused_self' and user_id = $1", [refusedUserId]);
  expect(personalRow.rows.length).toBe(1);

  const refusedContext = await browser.newContext();
  const refusedPage = await refusedContext.newPage();
  const refusedToken = await createSignInToken(refusedClerkUserId);
  await signInWithTicket(refusedPage, refusedToken, "/access-refused");
  await expect(refusedPage.getByText("Mise à jour de votre demande")).toBeVisible({ timeout: 10_000 });
  await refusedContext.close();
});
