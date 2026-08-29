// PHASE 2A.0 — unit tests for the transitional /admin backstop
// requireInternalStaff() (lib/admin-access.ts). Run with:
//   npx tsx --test lib/admin-access.test.mjs
//
// Same approach as lib/dev-role.test.mjs: mock ONLY @/lib/session's
// requireSession() (fabricated sessions/redirects instead of a live
// Clerk/DB connection); next/navigation's redirect() is the REAL
// implementation — it always throws a NEXT_REDIRECT control-flow error by
// design, so we let it throw and assert on the digest.
//
// The mock reproduces requireSession()'s real four non-active redirects
// verbatim (see lib/session.ts): unauthenticated -> /sign-in, pending ->
// /access-pending?ctx=pending, refused -> /access-refused, suspended ->
// /access-suspended — so requireInternalStaff(), which delegates all four
// to requireSession(), is exercised exactly as it runs in production.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { redirect } from "next/navigation";

/** @type {{ kind: "unauthenticated" | "pending" | "refused" | "suspended" } | { kind: "active"; role: string }} */
let mockState = { kind: "unauthenticated" };

mock.module("@/lib/session", {
  namedExports: {
    // Mirrors the real requireSession() in lib/session.ts exactly.
    requireSession: async () => {
      if (mockState.kind === "unauthenticated") redirect("/sign-in");
      if (mockState.kind === "pending") redirect("/access-pending?ctx=pending");
      if (mockState.kind === "refused") redirect("/access-refused");
      if (mockState.kind === "suspended") redirect("/access-suspended");
      return {
        userId: "u1",
        clerkUserId: "c1",
        email: "t@test.com",
        fullName: "Test",
        firstName: "Test",
        organizationId: "o1",
        organizationName: "Org",
        role: mockState.role,
        previousLastLoginAt: null,
      };
    },
  },
});

const { requireInternalStaff } = await import("./admin-access.ts");

function withActiveRole(role) {
  mockState = { kind: "active", role };
}
function withState(kind) {
  mockState = { kind };
}

async function assertRedirectsTo(fn, expectedUrl) {
  try {
    await fn();
    assert.fail(`expected a redirect to ${expectedUrl}, but the function returned normally`);
  } catch (err) {
    const digest = err?.digest ?? "";
    assert.match(digest, /^NEXT_REDIRECT/, `expected a Next redirect throw, got: ${err?.message ?? err}`);
    assert.ok(digest.includes(expectedUrl), `expected redirect to ${expectedUrl}, got digest: ${digest}`);
  }
}

// ---- active non-client roles: allowed, role returned unchanged ----------
for (const role of ["admin", "staff", "agent", "supervisor"]) {
  test(`requireInternalStaff allows active role=${role} and returns it`, async () => {
    withActiveRole(role);
    assert.equal(await requireInternalStaff(), role);
  });
}

// ---- client: fails closed at the /admin boundary -----------------------
test("requireInternalStaff redirects an active client to /dashboard, never allows /admin", async () => {
  withActiveRole("client");
  await assertRedirectsTo(requireInternalStaff, "/dashboard");
});

// ---- non-active states: preserve requireSession()'s exact redirects ----
test("requireInternalStaff : unauthenticated -> /sign-in", async () => {
  withState("unauthenticated");
  await assertRedirectsTo(requireInternalStaff, "/sign-in");
});

test("requireInternalStaff : pending -> /access-pending", async () => {
  withState("pending");
  await assertRedirectsTo(requireInternalStaff, "/access-pending");
});

test("requireInternalStaff : refused -> /access-refused", async () => {
  withState("refused");
  await assertRedirectsTo(requireInternalStaff, "/access-refused");
});

test("requireInternalStaff : suspended -> /access-suspended", async () => {
  withState("suspended");
  await assertRedirectsTo(requireInternalStaff, "/access-suspended");
});
