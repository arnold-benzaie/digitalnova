// Integration tests for P0.1B.4's first internal catalogue consumer
// (app/admin/catalogue/page.tsx).
//
// Guard behavior mirrors lib/dev-role.test.mjs exactly: only @/lib/session
// is mocked, next/navigation's real redirect() is left to throw its own
// NEXT_REDIRECT control-flow error, asserted on via its digest — the
// guard's own internal correctness is already fully covered there; what
// this file adds is proof that THIS page actually calls it before doing
// anything else.
//
// Data behavior seeds the local disposable Docker Postgres (never
// Preview/Production) with the exact canonical dataset imported from
// db/catalogue/canonical-dataset.mjs, same convention as
// lib/catalogue/queries.integration.test.mjs.
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

const { db } = await import("@/db");
const { services, serviceMarketOffers, serviceRelations, serviceLegacyIdentifiers } = await import("@/db/schema");
const { SERVICES, MARKET_OFFERS, RELATIONS } = await import("@/db/catalogue/canonical-dataset.mjs");
const { default: CatalogueAdminPage } = await import("@/app/admin/catalogue/page.tsx");
const { buildCatalogueViewModel } = await import("@/lib/catalogue/view-model");

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
  await assertRedirectsTo(CatalogueAdminPage, "/dashboard");
});

test("unauthenticated: page redirects to /sign-in", async () => {
  mockState = { kind: "unauthenticated" };
  await assertRedirectsTo(CatalogueAdminPage, "/sign-in");
});

test("authenticated with no membership: page redirects to /access-pending", async () => {
  mockState = { kind: "no-role" };
  await assertRedirectsTo(CatalogueAdminPage, "/access-pending");
});

for (const role of ["staff", "admin", "agent", "supervisor"]) {
  test(`${role} role: page renders without redirecting (empty catalogue)`, async () => {
    withRole(role);
    const result = await CatalogueAdminPage();
    assert.ok(result, "expected the page to return a rendered element, not throw or redirect");
  });
}

// ---- data correctness, against the seeded canonical dataset ----

test("data correctness against the full canonical dataset", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);

  const model = await buildCatalogueViewModel();

  await t.test("32 services", () => {
    assert.equal(model.services.length, 32);
  });

  await t.test("Canada offers are all CAD, Europe offers are all EUR", () => {
    for (const offer of model.canadaByService.values()) assert.equal(offer.currency, "CAD");
    for (const offer of model.europeByService.values()) assert.equal(offer.currency, "EUR");
    assert.equal(model.canadaByService.size, 26);
    assert.equal(model.europeByService.size, 26);
  });

  await t.test("Ads price is 1290.00 CAD / 890.00 EUR", () => {
    assert.equal(model.canadaByService.get("ads_campaigns_management").price, "1290.00");
    assert.equal(model.europeByService.get("ads_campaigns_management").price, "890.00");
  });

  await t.test("7 PACK_INCLUDES relations represented", () => {
    const packParents = model.services.filter((s) => s.type === "PACK").map((s) => s.serviceId);
    const total = packParents.reduce((sum, id) => sum + (model.childrenByParent.get(id)?.length ?? 0), 0);
    assert.equal(total, 7);
  });

  await t.test("12 DUO_INCLUDES relations represented", () => {
    const duoParents = model.services.filter((s) => s.type === "DUO").map((s) => s.serviceId);
    const total = duoParents.reduce((sum, id) => sum + (model.childrenByParent.get(id)?.length ?? 0), 0);
    assert.equal(total, 12);
  });

  await t.test("pack_local_growth -> ai_visibility present", () => {
    const children = model.childrenByParent.get("pack_local_growth") ?? [];
    assert.ok(children.some((c) => c.childServiceId === "ai_visibility"));
  });

  await t.test("pack_local_growth -> pack_gbp_seo_launch absent", () => {
    const children = model.childrenByParent.get("pack_local_growth") ?? [];
    assert.ok(!children.some((c) => c.childServiceId === "pack_gbp_seo_launch"));
  });

  await t.test("a duo has no market offer in either market (no fabricated price)", () => {
    assert.equal(model.canadaByService.get("duo_brand_foundation"), undefined);
    assert.equal(model.europeByService.get("duo_brand_foundation"), undefined);
  });
});

test("empty catalogue: buildCatalogueViewModel returns zero services, not an error", async () => {
  // Tables are already empty at this point (previous test's t.after ran).
  const model = await buildCatalogueViewModel();
  assert.equal(model.services.length, 0);
  assert.equal(model.canadaByService.size, 0);
});

test("staff role with data present: full page renders end-to-end without throwing", async (t) => {
  await seedCanonicalDataset();
  t.after(clearCatalogueTables);
  withRole("staff");
  const result = await CatalogueAdminPage();
  assert.ok(result);
});

// ---- mutation-control guarantee (static, no DB) ----

test("page.tsx contains no create/edit/delete/publish control and no Drizzle write call", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "page.tsx"), "utf8");
  for (const forbidden of ["db.insert(", "db.update(", "db.delete(", "onClick", "<button", "<Button", "<form", "<Form"]) {
    assert.ok(!source.includes(forbidden), `found forbidden control/write in page.tsx: ${forbidden}`);
  }
});
