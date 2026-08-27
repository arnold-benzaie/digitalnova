// Integration tests for the Catalogue business V1
// (app/admin/catalogue/page.tsx).
//
// Guard behavior mirrors lib/dev-role.test.mjs exactly: only @/lib/session
// is mocked, next/navigation's real redirect() is left to throw its own
// NEXT_REDIRECT control-flow error, asserted on via its digest.
//
// Data behavior seeds the local disposable Docker Postgres (never
// Preview/Production) with the exact canonical dataset imported from
// db/catalogue/canonical-dataset.mjs, same convention as
// lib/catalogue/queries.integration.test.mjs.
//
// The page returns a React element tree (no rendering harness in this
// repo) — rather than only checking "it returns something truthy" like the
// old raw-table version's tests did, a small tree-walk helper below finds
// every rendered ServiceCard so search/type-filter behavior (which lives in
// page.tsx itself, not in buildCatalogueViewModel()) is actually exercised,
// not just assumed from the unfiltered view-model data.
//
// Run with: npx tsx --test --experimental-test-module-mocks app/admin/catalogue/page.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

mock.module("server-only", { namedExports: {} });

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Preview/Production. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

/** @type {{ kind: "unauthenticated" } | { kind: "no-role" } | { kind: "session"; session: object }} */
let mockState = { kind: "unauthenticated" };

mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      const { redirect } = await import("next/navigation");
      if (mockState.kind === "unauthenticated") redirect("/sign-in");
      if (mockState.kind === "no-role") redirect("/access-pending");
      return mockState.session;
    },
  },
});

function withRole(role) {
  mockState = { kind: "session", session: { userId: "u1", clerkUserId: "c1", email: "t@test.com", fullName: "Test", organizationId: "o1", organizationName: "Org", role } };
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

/** Walks a React element tree's props.children looking for elements whose
 * `type` matches the given function component — no rendering, just plain
 * object traversal (this repo has no rendering harness for server
 * components). */
function findElementsByType(node, type, found = []) {
  if (node == null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) findElementsByType(child, type, found);
    return found;
  }
  if (node.type === type) found.push(node);
  const children = node.props?.children;
  if (children !== undefined) findElementsByType(children, type, found);
  return found;
}

function searchParamsOf(params) {
  return Promise.resolve(params ?? {});
}

const { db } = await import("@/db");
const { services, serviceMarketOffers, serviceRelations, serviceLegacyIdentifiers } = await import("@/db/schema");
const { SERVICES, MARKET_OFFERS, RELATIONS } = await import("@/db/catalogue/canonical-dataset.mjs");
const { default: CatalogueAdminPage } = await import("@/app/admin/catalogue/page.tsx");
const { ServiceCard } = await import("@/components/catalogue/service-card.tsx");

async function seedCanonicalDataset() {
  for (const s of SERVICES) {
    await db.insert(services).values({
      serviceId: s.serviceId,
      type: s.type,
      category: s.category,
      displayNameFr: s.displayNameFr,
      displayNameEn: s.displayNameEn,
      descriptionFr: s.descriptionFr,
      descriptionEn: s.descriptionEn,
      priceDerivation: s.priceDerivation,
    });
  }
  for (const o of MARKET_OFFERS) {
    await db.insert(serviceMarketOffers).values({
      serviceId: o.serviceId,
      market: o.market,
      currency: o.currency,
      price: o.price,
      paymentFrequency: o.paymentFrequency,
      billingType: o.billingType,
      taxDisplay: o.taxDisplay,
      ctaType: o.ctaType,
      checkoutStatus: o.checkoutStatus,
    });
  }
  for (const r of RELATIONS) {
    await db.insert(serviceRelations).values({ parentServiceId: r.parentServiceId, childServiceId: r.childServiceId, relationType: r.relationType, displayOrder: r.displayOrder });
  }
}

async function clearCatalogueTables() {
  await db.delete(serviceLegacyIdentifiers);
  await db.delete(serviceRelations);
  await db.delete(serviceMarketOffers);
  await db.delete(services);
}

after(async () => {
  await db.$client.end();
});

// ---- guard behavior ----

test("client role: page redirects to /dashboard, never fetches data", async () => {
  withRole("client");
  await assertRedirectsTo(() => CatalogueAdminPage({ searchParams: searchParamsOf() }), "/dashboard");
});

test("unauthenticated: page redirects to /sign-in", async () => {
  mockState = { kind: "unauthenticated" };
  await assertRedirectsTo(() => CatalogueAdminPage({ searchParams: searchParamsOf() }), "/sign-in");
});

test("authenticated with no membership: page redirects to /access-pending", async () => {
  mockState = { kind: "no-role" };
  await assertRedirectsTo(() => CatalogueAdminPage({ searchParams: searchParamsOf() }), "/access-pending");
});

for (const role of ["staff", "admin", "agent", "supervisor"]) {
  test(`${role} role: page renders without redirecting (empty catalogue)`, async () => {
    withRole(role);
    const result = await CatalogueAdminPage({ searchParams: searchParamsOf() });
    assert.ok(result, "expected the page to return a rendered element, not throw or redirect");
  });
}

// ---- data correctness + filtering, against the seeded canonical dataset ----

test("no filter: renders exactly 32 ServiceCard, one per canonical service", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);
  withRole("staff");

  const result = await CatalogueAdminPage({ searchParams: searchParamsOf() });
  const cards = findElementsByType(result, ServiceCard);
  assert.equal(cards.length, 32);
  const ids = new Set(cards.map((c) => c.props.service.serviceId));
  assert.equal(ids.size, 32, "no duplicate service rendered");
});

test("type filter PACK: exactly the 6 canonical PACK services, all typed PACK", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);
  withRole("staff");

  const result = await CatalogueAdminPage({ searchParams: searchParamsOf({ type: "PACK" }) });
  const cards = findElementsByType(result, ServiceCard);
  assert.equal(cards.length, 6);
  for (const c of cards) assert.equal(c.props.service.type, "PACK");
});

test("type filter DUO: exactly the 6 canonical DUO services, all typed DUO", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);
  withRole("staff");

  const result = await CatalogueAdminPage({ searchParams: searchParamsOf({ type: "DUO" }) });
  const cards = findElementsByType(result, ServiceCard);
  assert.equal(cards.length, 6);
  for (const c of cards) assert.equal(c.props.service.type, "DUO");
});

test("type filter INDIVIDUAL_SERVICE: exactly the 20 canonical individual services", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);
  withRole("staff");

  const result = await CatalogueAdminPage({ searchParams: searchParamsOf({ type: "INDIVIDUAL_SERVICE" }) });
  const cards = findElementsByType(result, ServiceCard);
  assert.equal(cards.length, 20);
  for (const c of cards) assert.equal(c.props.service.type, "INDIVIDUAL_SERVICE");
});

test("search by exact service_id: matches only that one service", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);
  withRole("staff");

  const result = await CatalogueAdminPage({ searchParams: searchParamsOf({ q: "ads_campaigns_management" }) });
  const cards = findElementsByType(result, ServiceCard);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].props.service.serviceId, "ads_campaigns_management");
});

test("search by a French name substring: matches at least that service, case-insensitively", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);
  withRole("staff");

  const target = SERVICES.find((s) => s.serviceId === "ads_campaigns_management");
  const substring = target.displayNameFr.split(" ")[0].toUpperCase();

  const result = await CatalogueAdminPage({ searchParams: searchParamsOf({ q: substring }) });
  const cards = findElementsByType(result, ServiceCard);
  assert.ok(
    cards.some((c) => c.props.service.serviceId === "ads_campaigns_management"),
    "expected the case-insensitive French-name search to include the target service",
  );
});

test("search with no match: zero ServiceCard rendered", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);
  withRole("staff");

  const result = await CatalogueAdminPage({ searchParams: searchParamsOf({ q: "this-matches-nothing-xyz" }) });
  const cards = findElementsByType(result, ServiceCard);
  assert.equal(cards.length, 0);
});

test("pack_local_growth's card shows readable included-service names, not raw service_ids", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);
  withRole("staff");

  const result = await CatalogueAdminPage({ searchParams: searchParamsOf({ q: "pack_local_growth" }) });
  const cards = findElementsByType(result, ServiceCard);
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.ok(card.props.childrenNames.length > 0, "expected pack_local_growth to have at least one included service");
  const aiVisibility = SERVICES.find((s) => s.serviceId === "ai_visibility");
  assert.ok(
    card.props.childrenNames.includes(aiVisibility.displayNameFr) || card.props.childrenNames.includes(aiVisibility.displayNameEn),
    "expected the included-service name to be the resolved display name, not the raw service_id",
  );
  assert.ok(!card.props.childrenNames.includes("ai_visibility"), "must never leak the raw service_id where a name is expected");
});

test("empty catalogue: renders zero ServiceCard, not an error", async () => {
  // Tables are already empty at this point (previous test's t.after ran).
  withRole("staff");
  const result = await CatalogueAdminPage({ searchParams: searchParamsOf() });
  const cards = findElementsByType(result, ServiceCard);
  assert.equal(cards.length, 0);
});

// ---- mutation-control guarantee (static, no DB) ----

test("page.tsx and service-card.tsx contain no create/edit/delete/publish control and no Drizzle write call", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pageSource = readFileSync(join(here, "page.tsx"), "utf8");
  const cardSource = readFileSync(join(here, "..", "..", "..", "components", "catalogue", "service-card.tsx"), "utf8");
  for (const [label, source] of [
    ["page.tsx", pageSource],
    ["service-card.tsx", cardSource],
  ]) {
    for (const forbidden of ["db.insert(", "db.update(", "db.delete(", "onClick", "<Button", "checkout"]) {
      assert.ok(!source.includes(forbidden), `found forbidden control/write in ${label}: ${forbidden}`);
    }
  }
  // The search/filter <form>/<button type="submit"> and <input>/<select> in
  // page.tsx are a plain GET navigation (read-only, same as
  // app/admin/crm/clients/page.tsx) — not a mutation surface, so they're
  // deliberately not in the forbidden list above.
});
