import { test, expect } from "@playwright/test";
import { Client } from "pg";

// Deterministic French assertions below — same fix already established for
// this reason in e2e-approval/user-approval.spec.ts / e2e/access-pending.spec.ts.
test.use({ locale: "fr-FR" });

/**
 * MISSION RADAR/CLIENT APPROVAL — PHASE 2 — real-browser E2E coverage for
 * the EMPLOYEE-facing /admin/client-approvals surface: reachability, the
 * pending-client list, a real approval through the real UI, the absence of
 * any OWNER/ADMIN/Workforce control, and MANAGER's denial. Runs against
 * the SAME dev server / local isolated Postgres as e2e-approval/user-
 * approval.spec.ts (playwright.approval.config.ts) — never Supabase
 * Production, never Clerk Production.
 *
 * Every Clerk identity used here is a fresh, throwaway Development user
 * created in beforeAll and deleted in afterAll — never the shared
 * contact@public-map.com account (that one stays ADMIN-only, exactly as
 * user-approval.spec.ts already uses it) and never any other real/shared
 * account.
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

async function createThrowawayClerkUser(emailPrefix: string, suffix: number) {
  const email = `${emailPrefix}-${suffix}@example.com`;
  const created = await clerkApi("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [email], first_name: emailPrefix, last_name: "E2E", skip_password_requirement: true }),
  });
  return { clerkUserId: created.id as string, email };
}

/** Same reliable-navigation shape as user-approval.spec.ts's own
 * signInWithTicket(): redirect_url points DIRECTLY at the expected
 * destination, never at an intermediate page that itself redirects. */
async function signInWithTicket(page: import("@playwright/test").Page, token: string, redirectTarget: string) {
  await page.goto(`/sign-in?__clerk_ticket=${token}&redirect_url=${encodeURIComponent(redirectTarget)}`, {
    waitUntil: "networkidle",
    timeout: 25_000,
  });
  await page.waitForURL(new RegExp(redirectTarget.split("?")[0].replace(/\//g, "\\/")), { timeout: 20_000 });
}

let publicMapOrgId: string;
let demoOrgId: string;
let employeeRoleId: string;
let managerRoleId: string;

let employeeClerkUserId: string;
let employeeDbUserId: string;
let managerClerkUserId: string;
let pendingClientClerkUserId: string;
let pendingClientEmail: string;

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

  const demoRes = await db.query("select id from organizations where name = 'Organisation Démo'");
  if (demoRes.rows.length !== 1) throw new Error("Organisation Démo introuvable dans la base de test locale.");
  demoOrgId = demoRes.rows[0].id;

  const employeeRoleRes = await db.query("select id from staff_roles where name = 'EMPLOYEE'");
  employeeRoleId = employeeRoleRes.rows[0].id;
  const managerRoleRes = await db.query("select id from staff_roles where name = 'MANAGER'");
  managerRoleId = managerRoleRes.rows[0].id;

  const suffix = Date.now();

  const employee = await createThrowawayClerkUser("e2e-employee", suffix);
  employeeClerkUserId = employee.clerkUserId;
  const [employeeDbUser] = (
    await db.query("insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      employeeClerkUserId,
      employee.email,
      "Employee E2E",
    ])
  ).rows;
  employeeDbUserId = employeeDbUser.id;
  await db.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1, $2, $3, 'ACTIVE')", [
    employeeDbUserId,
    publicMapOrgId,
    employeeRoleId,
  ]);

  const manager = await createThrowawayClerkUser("e2e-manager", suffix);
  managerClerkUserId = manager.clerkUserId;
  const [managerDbUser] = (
    await db.query("insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      managerClerkUserId,
      manager.email,
      "Manager E2E",
    ])
  ).rows;
  await db.query("insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1, $2, $3, 'ACTIVE')", [
    managerDbUser.id,
    publicMapOrgId,
    managerRoleId,
  ]);

  // Pending self-signup CLIENT target — a real Clerk user exists so the
  // fixture matches production shape, but this test signs in as the
  // EMPLOYEE/MANAGER, never as this account.
  const pendingClient = await createThrowawayClerkUser("e2e-pending-client", suffix);
  pendingClientClerkUserId = pendingClient.clerkUserId;
  pendingClientEmail = pendingClient.email;
  await db.query("insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, 'pending')", [
    pendingClientClerkUserId,
    pendingClientEmail,
    "Pending Client E2E",
  ]);
});

test.afterAll(async () => {
  for (const id of [employeeClerkUserId, managerClerkUserId, pendingClientClerkUserId]) {
    if (id) await clerkApi(`/users/${id}`, { method: "DELETE" }).catch(() => {});
  }
  await db.query("delete from memberships where user_id = any($1)", [[employeeDbUserId].filter(Boolean)]);
  await db.query("delete from staff_members where user_id = any(select id from users where clerk_user_id = any($1))", [
    [employeeClerkUserId, managerClerkUserId].filter(Boolean),
  ]);
  await db.query("delete from users where clerk_user_id = any($1)", [
    [employeeClerkUserId, managerClerkUserId, pendingClientClerkUserId].filter(Boolean),
  ]);
  await db.end();
});

test("EMPLOYEE atteint /admin/client-approvals, voit le client en attente, approuve via l'UI réelle — sans aucun contrôle OWNER/ADMIN/Workforce", async ({ page }) => {
  const token = await createSignInToken(employeeClerkUserId);
  await signInWithTicket(page, token, "/admin/client-approvals");
  await expect(page).toHaveURL(/\/admin\/client-approvals/);

  await expect(page.getByText(pendingClientEmail)).toBeVisible({ timeout: 20_000 });

  // No admin-only affordance anywhere on this page: no "Rôle" field (this
  // surface hard-codes "client" server-side and never offers a choice), no
  // admin-confirmation checkbox, no OWNER/Workforce label.
  await expect(page.getByLabel("Rôle", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/confirmation.*administrateur/i)).toHaveCount(0);
  await expect(page.getByText(/Workforce/i)).toHaveCount(0);
  await expect(page.getByText(/Owner|Propriétaire/i)).toHaveCount(0);

  const row = page.locator("tr", { has: page.getByText(pendingClientEmail) });
  await row.getByRole("combobox").selectOption({ label: "Organisation Démo" });
  await row.getByRole("button", { name: "Approuver" }).click();

  await expect(page.getByText(pendingClientEmail)).toHaveCount(0, { timeout: 20_000 });

  const rows = await db.query("select status from users where clerk_user_id = $1", [pendingClientClerkUserId]);
  expect(rows.rows[0].status).toBe("active");
  const membership = await db.query(
    "select r.name as role, m.organization_id as org from memberships m join roles r on r.id = m.role_id join users u on u.id = m.user_id where u.clerk_user_id = $1",
    [pendingClientClerkUserId],
  );
  expect(membership.rows[0].role).toBe("client");
  expect(membership.rows[0].org).toBe(demoOrgId);

  const audit = await db.query(
    "select actor_user_id from audit_log where action = 'user.approved' and target_id = (select id::text from users where clerk_user_id = $1) order by created_at desc limit 1",
    [pendingClientClerkUserId],
  );
  expect(audit.rows[0].actor_user_id).toBe(employeeDbUserId);
});

test("MANAGER n'accède pas à /admin/client-approvals : redirigé vers /admin, aucune donnée cliente exposée", async ({ page }) => {
  const token = await createSignInToken(managerClerkUserId);
  await signInWithTicket(page, token, "/admin/client-approvals");

  await page.waitForURL((u) => u.pathname === "/admin", { timeout: 20_000 });
  await expect(page).toHaveURL((u) => u.pathname === "/admin");
});
