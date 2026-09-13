// HIERARCHICAL VISIBILITY AUDIT — integration test for /admin/users's
// viewer-aware OWNER exclusion: an ADMIN viewer must never receive the
// OWNER row (email, Clerk id, role, status — none of it, server-side, not
// just hidden in the UI), while still receiving other ADMIN rows ("ADMIN
// peut voir les autres ADMIN") and CLIENT rows unchanged. The OWNER
// viewer themselves is exempt from the exclusion.
//
// Same conventions as lib/actions/user-approval.test.mjs (real local
// Postgres, @/lib/session mocked with a mutable session so the REAL
// requireAdminRole()/AdminUsersPage query run unmodified) combined with
// app/admin/workforce/page.test.mjs's "call the page function directly,
// inspect the returned element's props" technique — AdminUsersPage does
// real Drizzle queries directly (no intermediate action to mock), so @/db
// is left real against the local disposable database, never mocked.
//
// Run with: npx tsx --test --experimental-test-module-mocks app/admin/users/page.integration.test.mjs
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });

/** @type {{ session: object | null }} */
let mockState = { session: null };
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!mockState.session) throw new Error("UNAUTHENTICATED — no session");
      return mockState.session;
    },
    getCurrentSession: async () => (mockState.session ? mockState.session : null),
    // Byte-identical copy of lib/session.ts::legacyAppRoleForWorkforce —
    // mock.module() replaces the ENTIRE "@/lib/session" module, so
    // lib/dev-role.ts's import of this function (used by requireAdminRole())
    // must be satisfied here too. See lib/dev-role.test.mjs's identical note.
    legacyAppRoleForWorkforce: (session) => (session.staffRole === "OWNER" || session.staffRole === "ADMIN" ? "admin" : "agent"),
  },
});

const { db } = await import("@/db");
const { users, organizations, roles, memberships, staffMembers, staffRoles } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const AdminUsersPageModule = await import("./page.tsx");
const AdminUsersPage = AdminUsersPageModule.default;

const createdUserIds = new Set();

async function requireOrg(name) {
  const [org] = await db.select().from(organizations).where(eq(organizations.name, name)).limit(1);
  if (!org) throw new Error(`Organisation de test "${name}" introuvable — le seed local doit être appliqué avant ces tests.`);
  return org;
}

async function roleId(name) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (!role) throw new Error(`Rôle "${name}" introuvable.`);
  return role.id;
}

async function staffRoleIdByName(name) {
  const [row] = await db.select().from(staffRoles).where(eq(staffRoles.name, name)).limit(1);
  if (!row) throw new Error(`Rôle Workforce "${name}" introuvable.`);
  return row.id;
}

async function createUser({ email, status = "active" }) {
  const clerkUserId = `test_clerk_${randomUUID()}`;
  const [user] = await db.insert(users).values({ clerkUserId, email, fullName: "Fixture User", status }).returning();
  createdUserIds.add(user.id);
  return user;
}

async function createActiveMember({ user, role, organizationId }) {
  await db.insert(memberships).values({ userId: user.id, organizationId, roleId: await roleId(role) });
}

async function makeActiveStaffMember(userId, workspaceOrgId, staffRoleName) {
  await db.insert(staffMembers).values({ userId, workspaceOrgId, roleId: await staffRoleIdByName(staffRoleName), status: "ACTIVE" });
}

function sessionFor(user, { context, role, staffRole, organizationId, organizationName }) {
  return context === "WORKFORCE"
    ? {
        context: "WORKFORCE",
        userId: user.id,
        clerkUserId: user.clerkUserId,
        email: user.email,
        fullName: user.fullName,
        firstName: "Test",
        organizationId,
        organizationName,
        staffRole,
        previousLastLoginAt: null,
      }
    : {
        context: "CLIENT",
        userId: user.id,
        clerkUserId: user.clerkUserId,
        email: user.email,
        fullName: user.fullName,
        firstName: "Test",
        organizationId,
        organizationName,
        role,
        previousLastLoginAt: null,
      };
}

let org;
let ownerDualContextUser, adminViewerUser, plainClientUser;

before(async () => {
  org = await requireOrg("PUBLIC-MAP");

  // The real OWNER shape found in Production: a dual-context user with
  // BOTH an Axis-A "admin" membership AND a real ACTIVE OWNER staff_members
  // row — this is exactly the row that must never reach a non-OWNER viewer.
  // staff_members_one_owner_per_workspace allows only one ACTIVE OWNER row
  // in this workspace, so this same fixture also plays the "OWNER viewer"
  // role below (seeing everyone, including their own row) rather than
  // creating a second OWNER identity.
  ownerDualContextUser = await createUser({ email: `${randomUUID()}@test.local` });
  await createActiveMember({ user: ownerDualContextUser, role: "admin", organizationId: org.id });
  await makeActiveStaffMember(ownerDualContextUser.id, org.id, "OWNER");

  // A dual-context ADMIN — must remain VISIBLE to another ADMIN viewer
  // ("ADMIN peut voir les autres ADMIN").
  adminViewerUser = await createUser({ email: `${randomUUID()}@test.local` });
  await createActiveMember({ user: adminViewerUser, role: "admin", organizationId: org.id });
  await makeActiveStaffMember(adminViewerUser.id, org.id, "ADMIN");

  // A plain Axis-A client, no Axis-C row at all — unaffected baseline.
  plainClientUser = await createUser({ email: `${randomUUID()}@test.local` });
  await createActiveMember({ user: plainClientUser, role: "client", organizationId: org.id });
});

// UNLIKE lib/actions/user-approval.test.mjs's "no cleanup, disposable DB"
// convention: this file creates a real OWNER staff_members row, and
// staff_members_one_owner_per_workspace allows only one ACTIVE OWNER per
// workspace — leaving it behind would break every subsequent run (and any
// other suite that needs to seed its own OWNER). Delete the fixture users
// created here; staff_members rows cascade with them (onDelete: cascade).
after(async () => {
  if (createdUserIds.size) {
    await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  }
  await db.$client.end();
});

function emailsOf(pageElement) {
  return pageElement.props.users.map((u) => u.email);
}

test("ADMIN viewer: ne reçoit jamais la ligne OWNER (dual-contexte), mais reçoit les autres ADMIN et les CLIENT", async () => {
  mockState = {
    session: sessionFor(adminViewerUser, { context: "CLIENT", role: "admin", organizationId: org.id, organizationName: org.name }),
  };
  const element = await AdminUsersPage({ searchParams: Promise.resolve({ status: "active" }) });
  const emails = emailsOf(element);

  assert.ok(!emails.includes(ownerDualContextUser.email), "l'email OWNER ne doit jamais apparaître pour un viewer ADMIN");
  assert.ok(emails.includes(adminViewerUser.email), "un ADMIN doit voir les autres ADMIN (y compris lui-même s'il a une membership Axis-A)");
  assert.ok(emails.includes(plainClientUser.email), "un CLIENT Axis-A pur doit rester visible");

  // Server-side projection, not a UI filter: the OWNER row must be absent
  // from the raw props entirely — no email, no id, no role, no status.
  const ownerRow = element.props.users.find((u) => u.id === ownerDualContextUser.id);
  assert.equal(ownerRow, undefined, "aucune donnée OWNER (même partielle) ne doit être présente dans la réponse serveur");
});

test("OWNER viewer: voit tout le monde, y compris sa propre ligne dual-contexte", async () => {
  mockState = {
    session: sessionFor(ownerDualContextUser, {
      context: "WORKFORCE",
      staffRole: "OWNER",
      organizationId: org.id,
      organizationName: org.name,
    }),
  };
  const element = await AdminUsersPage({ searchParams: Promise.resolve({ status: "active" }) });
  const emails = emailsOf(element);

  assert.ok(emails.includes(ownerDualContextUser.email), "l'OWNER doit voir la ligne OWNER dual-contexte");
  assert.ok(emails.includes(adminViewerUser.email), "l'OWNER doit voir les ADMIN");
  assert.ok(emails.includes(plainClientUser.email), "l'OWNER doit voir les CLIENT");
});
