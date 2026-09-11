// RADAR INTELLIGENCE V2.1 — Phase A — Provider Policy domain tests.
//
// PURE domain module: no DB, no env, no session, no logging, no network.
// Proves resolveProviderPolicy() is deterministic and fail-closed, and
// that DEFAULT_PROVIDER_POLICY reproduces today's exact Production
// routing (Anthropic primary, OpenAI fallback, no user selection).
//
// "gemini" appears in a few of these tests as a plain STRING value the
// pure resolver treats like any other IntelligenceProviderId — it is
// already a first-class member of that type (types.ts's own documented
// future-provider list), so exercising the resolver's N-provider/ordering
// semantics against it is not "adding Gemini": no adapter, no config, no
// env var, no registration exists anywhere. This file never imports or
// touches anything provider-specific at all.
//
// Run: npx tsx --test lib/radar-intelligence/provider-policy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PROVIDER_POLICY, resolveProviderPolicy } from "./provider-policy.ts";

function policy(overrides = {}) {
  return {
    mode: "AUTO",
    defaultProvider: "anthropic",
    fallbackOrder: ["anthropic", "openai"],
    enabledProviders: ["anthropic", "openai"],
    userSelectableProviders: [],
    allowUserSelection: false,
    fallbackEnabled: true,
    ...overrides,
  };
}

const BOTH_REGISTERED = new Set(["anthropic", "openai"]);

// ---------------- DEFAULT_PROVIDER_POLICY itself ----------------

test("DEFAULT_PROVIDER_POLICY reproduces today's exact Production routing shape", () => {
  assert.deepEqual(DEFAULT_PROVIDER_POLICY, {
    mode: "AUTO",
    defaultProvider: "anthropic",
    fallbackOrder: ["anthropic", "openai"],
    enabledProviders: ["anthropic", "openai"],
    userSelectableProviders: [],
    allowUserSelection: false,
    fallbackEnabled: true,
  });
});

test("DEFAULT_PROVIDER_POLICY is deep-frozen -- no runtime code can mutate it", () => {
  assert.throws(() => {
    DEFAULT_PROVIDER_POLICY.mode = "MANUAL";
  }, TypeError);
  assert.throws(() => {
    // @ts-expect-error -- intentionally attempting a mutation the type forbids, to prove it's runtime-frozen too
    DEFAULT_PROVIDER_POLICY.enabledProviders.push("gemini");
  }, TypeError);
});

// ---------------- A. Default policy, both registered ----------------

test("A: default policy, both Anthropic + OpenAI registered -> primary anthropic, fallbackChain [openai]", () => {
  const resolved = resolveProviderPolicy({ ownerPolicy: DEFAULT_PROVIDER_POLICY, registeredProviders: BOTH_REGISTERED });
  assert.equal(resolved.primary, "anthropic");
  assert.deepEqual(resolved.fallbackChain, ["openai"]);
  assert.equal(resolved.fallbackEnabled, true);
  assert.equal(resolved.source, "auto-default");
});

// ---------------- B. Anthropic absent ----------------

test("B: Anthropic absent, only OpenAI registered -> primary openai, no duplicate fallback", () => {
  const resolved = resolveProviderPolicy({ ownerPolicy: DEFAULT_PROVIDER_POLICY, registeredProviders: new Set(["openai"]) });
  assert.equal(resolved.primary, "openai");
  assert.deepEqual(resolved.fallbackChain, []);
  assert.equal(resolved.source, "auto-default");
});

// ---------------- C. OpenAI absent ----------------

test("C: OpenAI absent, only Anthropic registered -> primary anthropic, no fallback", () => {
  const resolved = resolveProviderPolicy({ ownerPolicy: DEFAULT_PROVIDER_POLICY, registeredProviders: new Set(["anthropic"]) });
  assert.equal(resolved.primary, "anthropic");
  assert.deepEqual(resolved.fallbackChain, []);
});

// ---------------- D. Both absent ----------------

test("D: both absent -> primary null, empty fallback chain, no throw", () => {
  const resolved = resolveProviderPolicy({ ownerPolicy: DEFAULT_PROVIDER_POLICY, registeredProviders: new Set() });
  assert.equal(resolved.primary, null);
  assert.deepEqual(resolved.fallbackChain, []);
  assert.equal(resolved.fallbackEnabled, false);
  assert.equal(resolved.source, "no-provider-available");
});

// ---------------- E. Disabled provider (registered but not in enabledProviders) ----------------

test("E: a provider registered but ABSENT from enabledProviders is never usable", () => {
  const resolved = resolveProviderPolicy({
    ownerPolicy: policy({ enabledProviders: ["anthropic"] }), // openai deliberately excluded from the OWNER allowlist
    registeredProviders: new Set(["anthropic", "openai"]), // openai IS registered/configured
  });
  assert.equal(resolved.primary, "anthropic");
  assert.deepEqual(resolved.fallbackChain, [], "openai must never appear -- it's registered but not OWNER-enabled");
});

// ---------------- F. Fallback order preserved (generic N-provider ordering) ----------------

test("F: fallbackOrder is preserved for a 3-provider set (generic ordering, using an already-union-member id as a pure test double)", () => {
  // "gemini" is already part of IntelligenceProviderId (types.ts) -- this
  // is a pure domain-level ordering test, not an integration of a real
  // Gemini provider.
  const resolved = resolveProviderPolicy({
    ownerPolicy: policy({
      defaultProvider: "gemini",
      fallbackOrder: ["gemini", "anthropic", "openai"],
      enabledProviders: ["gemini", "anthropic", "openai"],
    }),
    registeredProviders: new Set(["gemini", "anthropic", "openai"]),
  });
  assert.equal(resolved.primary, "gemini");
  assert.deepEqual(resolved.fallbackChain, ["anthropic", "openai"], "OWNER-defined order is preserved exactly");
});

test("F variant: fallbackOrder is filtered to usable providers, preserving relative order", () => {
  const resolved = resolveProviderPolicy({
    ownerPolicy: policy({ fallbackOrder: ["gemini", "anthropic", "openai"], enabledProviders: ["gemini", "anthropic", "openai"], defaultProvider: "anthropic" }),
    registeredProviders: new Set(["anthropic", "openai"]), // gemini not registered
  });
  assert.equal(resolved.primary, "anthropic");
  assert.deepEqual(resolved.fallbackChain, ["openai"], "gemini is filtered out -- never usable, never appears");
});

// ---------------- G. fallbackEnabled=false ----------------

test("G: fallbackEnabled=false -> empty fallback chain even with a usable fallback provider", () => {
  const resolved = resolveProviderPolicy({ ownerPolicy: policy({ fallbackEnabled: false }), registeredProviders: BOTH_REGISTERED });
  assert.equal(resolved.primary, "anthropic");
  assert.deepEqual(resolved.fallbackChain, []);
  assert.equal(resolved.fallbackEnabled, false);
});

// ---------------- H. MANUAL valid ----------------

test("H: MANUAL valid -- a requested provider that is selectable + enabled + registered becomes primary", () => {
  const resolved = resolveProviderPolicy({
    ownerPolicy: policy({ mode: "MANUAL", allowUserSelection: true, userSelectableProviders: ["openai"] }),
    registeredProviders: BOTH_REGISTERED,
    requestedProviderId: "openai",
  });
  assert.equal(resolved.primary, "openai");
  assert.deepEqual(resolved.fallbackChain, ["anthropic"]);
  assert.equal(resolved.source, "user-manual");
});

test("H variant: MANUAL valid with fallbackEnabled=false -> no fallback chain even for a valid manual pick", () => {
  const resolved = resolveProviderPolicy({
    ownerPolicy: policy({ allowUserSelection: true, userSelectableProviders: ["openai"], fallbackEnabled: false }),
    registeredProviders: BOTH_REGISTERED,
    requestedProviderId: "openai",
  });
  assert.equal(resolved.primary, "openai");
  assert.deepEqual(resolved.fallbackChain, []);
  assert.equal(resolved.source, "user-manual");
});

// ---------------- I. MANUAL invalid -> AUTO fallback ----------------

test("I: MANUAL invalid (not registered) -> safely degrades to AUTO, never throws", () => {
  const resolved = resolveProviderPolicy({
    ownerPolicy: policy({ allowUserSelection: true, userSelectableProviders: ["openai"] }),
    registeredProviders: new Set(["anthropic"]), // openai requested but not registered
    requestedProviderId: "openai",
  });
  assert.equal(resolved.primary, "anthropic");
  assert.equal(resolved.source, "user-manual-invalid-fallback-to-auto");
});

test("I variant: MANUAL invalid (unknown/unauthorized id, e.g. a forged client string) -> AUTO, no throw, no enumeration signal", () => {
  for (const forged of ["some-forged-id", "", "DROP TABLE", "anthropic; openai"]) {
    assert.doesNotThrow(() =>
      resolveProviderPolicy({
        ownerPolicy: policy({ allowUserSelection: true, userSelectableProviders: ["openai"] }),
        registeredProviders: BOTH_REGISTERED,
        requestedProviderId: forged,
      }),
    );
    const resolved = resolveProviderPolicy({
      ownerPolicy: policy({ allowUserSelection: true, userSelectableProviders: ["openai"] }),
      registeredProviders: BOTH_REGISTERED,
      requestedProviderId: forged,
    });
    assert.equal(resolved.primary, "anthropic", `forged id ${JSON.stringify(forged)} must resolve to the same safe AUTO result`);
    assert.equal(resolved.source, "user-manual-invalid-fallback-to-auto");
  }
});

// ---------------- J. allowUserSelection=false ----------------

test("J: allowUserSelection=false -> requested provider ignored entirely, AUTO behavior", () => {
  const resolved = resolveProviderPolicy({
    ownerPolicy: policy({ allowUserSelection: false, userSelectableProviders: ["openai"] }),
    registeredProviders: BOTH_REGISTERED,
    requestedProviderId: "openai",
  });
  assert.equal(resolved.primary, "anthropic", "the OWNER-configured default wins -- selection is globally off");
  assert.equal(resolved.source, "user-manual-invalid-fallback-to-auto");
});

// ---------------- K. userSelectableProviders cannot authorize a globally disabled provider ----------------

test("K: a provider in userSelectableProviders but ABSENT from enabledProviders can never be selected", () => {
  const resolved = resolveProviderPolicy({
    ownerPolicy: policy({ allowUserSelection: true, enabledProviders: ["anthropic"], userSelectableProviders: ["openai"] }),
    registeredProviders: BOTH_REGISTERED,
    requestedProviderId: "openai",
  });
  assert.equal(resolved.primary, "anthropic", "userSelectableProviders alone is never sufficient authorization");
  assert.equal(resolved.source, "user-manual-invalid-fallback-to-auto");
});

// ---------------- L. no mutation ----------------

test("L: resolveProviderPolicy never mutates its input policy's arrays/sets", () => {
  const input = policy({ allowUserSelection: true, userSelectableProviders: ["openai"] });
  const fallbackOrderBefore = [...input.fallbackOrder];
  const enabledBefore = [...input.enabledProviders];
  const selectableBefore = [...input.userSelectableProviders];
  const registered = new Set(BOTH_REGISTERED);
  const registeredBefore = new Set(registered);

  resolveProviderPolicy({ ownerPolicy: input, registeredProviders: registered, requestedProviderId: "openai" });

  assert.deepEqual(input.fallbackOrder, fallbackOrderBefore);
  assert.deepEqual(input.enabledProviders, enabledBefore);
  assert.deepEqual(input.userSelectableProviders, selectableBefore);
  assert.deepEqual([...registered], [...registeredBefore]);
});

test("L variant: repeated calls with the SAME input produce the SAME result (pure function, no hidden state)", () => {
  const input = policy();
  const registered = BOTH_REGISTERED;
  const first = resolveProviderPolicy({ ownerPolicy: input, registeredProviders: registered });
  const second = resolveProviderPolicy({ ownerPolicy: input, registeredProviders: registered });
  assert.deepEqual(first, second);
});

// ---------------- additional edge cases ----------------

test("defaultProvider null -> falls back to the first usable entry of fallbackOrder", () => {
  const resolved = resolveProviderPolicy({ ownerPolicy: policy({ defaultProvider: null }), registeredProviders: BOTH_REGISTERED });
  assert.equal(resolved.primary, "anthropic");
});

test("defaultProvider set but not usable (disabled/unregistered) -> falls back to the first usable fallbackOrder entry", () => {
  const resolved = resolveProviderPolicy({
    ownerPolicy: policy({ defaultProvider: "anthropic" }),
    registeredProviders: new Set(["openai"]), // anthropic not registered
  });
  assert.equal(resolved.primary, "openai");
});

test("requestedProviderId omitted entirely (no preference at all) -> plain AUTO, source auto-default", () => {
  const resolved = resolveProviderPolicy({ ownerPolicy: DEFAULT_PROVIDER_POLICY, registeredProviders: BOTH_REGISTERED });
  assert.equal(resolved.source, "auto-default");
});

test("requestedProviderId explicitly null -> treated identically to omitted (still AUTO, not the invalid-fallback source)", () => {
  const resolved = resolveProviderPolicy({ ownerPolicy: DEFAULT_PROVIDER_POLICY, registeredProviders: BOTH_REGISTERED, requestedProviderId: null });
  assert.equal(resolved.source, "auto-default");
});
