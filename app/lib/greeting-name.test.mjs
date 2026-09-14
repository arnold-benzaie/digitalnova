// DASHBOARD PERSONALIZATION — unit tests for resolveGreetingName(), the
// shared helper (lib/greeting-name.ts) now used by BOTH app/dashboard/page.tsx
// (CLIENT context) and app/admin/page.tsx (WORKFORCE context: OWNER/ADMIN/
// MANAGER/EMPLOYEE) so a Workforce-only user (e.g. Samira, EMPLOYEE with no
// Axis-A membership) gets a real "Bonjour Samira" greeting on /admin instead
// of a generic, non-personalized heading — never a hardcoded name, never a
// client-supplied identity, only server-resolved session fields.
//
// No DB, no mocks needed: resolveGreetingName() is a pure function of the
// plain session object shape (CurrentSession's common fields), identical for
// ClientSession and WorkforceSession.
//
// Run with: npx tsx --test lib/greeting-name.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGreetingName } from "./greeting-name.ts";

function session(overrides) {
  return {
    context: "WORKFORCE",
    userId: "u1",
    clerkUserId: "clerk_1",
    email: "fallback@example.com",
    fullName: null,
    firstName: null,
    organizationId: "org1",
    organizationName: "PUBLIC-MAP",
    staffRole: "EMPLOYEE",
    previousLastLoginAt: null,
    ...overrides,
  };
}

test("priorise le prénom quand il est présent", () => {
  assert.equal(resolveGreetingName(session({ firstName: "Samira", fullName: "Samira Test", organizationName: "Org" })), "Samira");
});

test("retombe sur le nom complet si aucun prénom", () => {
  assert.equal(resolveGreetingName(session({ firstName: null, fullName: "Arnaud Dupont" })), "Arnaud Dupont");
});

test("retombe sur le nom de l'organisation si ni prénom ni nom complet", () => {
  assert.equal(resolveGreetingName(session({ firstName: null, fullName: null, organizationName: "PUBLIC-MAP" })), "PUBLIC-MAP");
});

test("retombe sur la partie locale de l'e-mail en dernier recours", () => {
  assert.equal(
    resolveGreetingName(session({ firstName: null, fullName: null, organizationName: "", email: "samira.k@example.com" })),
    "samira.k",
  );
});

test("retourne null si aucune identité exploitable n'est disponible (fallback générique du composant)", () => {
  assert.equal(resolveGreetingName(session({ firstName: "  ", fullName: null, organizationName: "", email: "@example.com" })), null);
});

test("ignore les valeurs littérales 'null'/'undefined' provenant d'un profil Clerk malformé", () => {
  assert.equal(
    resolveGreetingName(session({ firstName: "null", fullName: "undefined", organizationName: "", email: "@example.com" })),
    null,
  );
});

test("tronque un nom anormalement long sans casser un grapheme composé (emoji)", () => {
  const longName = "🙂".repeat(60);
  const result = resolveGreetingName(session({ firstName: longName }));
  assert.ok(result.length < longName.length);
  assert.ok(result.endsWith("…"));
});

test("fonctionne identiquement pour une session CLIENT (même forme de champs)", () => {
  const clientSession = {
    context: "CLIENT",
    userId: "u2",
    clerkUserId: "clerk_2",
    email: "client@example.com",
    fullName: "Marc Client",
    firstName: null,
    organizationId: "org1",
    organizationName: "PUBLIC-MAP",
    role: "client",
    previousLastLoginAt: null,
  };
  assert.equal(resolveGreetingName(clientSession), "Marc Client");
});
