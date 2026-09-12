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

import {
  DEFAULT_PROVIDER_POLICY,
  resolveProviderPolicy,
  POLICY_CONFIGURABLE_PROVIDER_IDS,
  isPolicyConfigurableProviderId,
  validateProviderPolicyCandidate,
} from "./provider-policy.ts";

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

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase B — validateProviderPolicyCandidate()
//
// Mandatory test matrix (mission Step 22, items A-J): the fail-closed,
// all-or-nothing DB/OWNER-input validator. Every malformed candidate
// below must be REJECTED as a whole -- never partially trusted, never
// silently normalized into a mix of real and substituted fields.
// =====================================================================

function candidate(overrides = {}) {
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

test("POLICY_CONFIGURABLE_PROVIDER_IDS is exactly [anthropic, openai] -- gemini/deepseek/kimi/local excluded in Phase B", () => {
  assert.deepEqual([...POLICY_CONFIGURABLE_PROVIDER_IDS], ["anthropic", "openai"]);
  for (const future of ["gemini", "deepseek", "kimi", "local"]) {
    assert.ok(!POLICY_CONFIGURABLE_PROVIDER_IDS.includes(future), `${future} must not be policy-configurable yet`);
  }
});

test("isPolicyConfigurableProviderId: true only for anthropic/openai, false for everything else including future placeholders", () => {
  assert.equal(isPolicyConfigurableProviderId("anthropic"), true);
  assert.equal(isPolicyConfigurableProviderId("openai"), true);
  for (const bad of ["gemini", "deepseek", "kimi", "local", "deterministic", "", "ANTHROPIC", 123, null, undefined, {}]) {
    assert.equal(isPolicyConfigurableProviderId(bad), false, `${JSON.stringify(bad)} must not be policy-configurable`);
  }
});

// ---- A: no row is handled by the store, not the validator -- N/A here ----

// ---- B: a valid, well-formed candidate validates ----

test("B: a fully valid candidate policy validates and round-trips its exact field values", () => {
  const result = validateProviderPolicyCandidate(candidate());
  assert.equal(result.ok, true);
  assert.deepEqual(result.policy, candidate());
});

test("B variant: a valid MANUAL policy with user selection validates", () => {
  const result = validateProviderPolicyCandidate(
    candidate({ mode: "MANUAL", allowUserSelection: true, userSelectableProviders: ["openai"], defaultProvider: "openai" }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.policy.mode, "MANUAL");
  assert.deepEqual(result.policy.userSelectableProviders, ["openai"]);
});

// ---- C: malformed mode ----

test("C: malformed mode is rejected as a whole (not silently coerced to AUTO)", () => {
  for (const badMode of ["auto", "manual", "AUTOMATIC", "", null, 1, undefined]) {
    const result = validateProviderPolicyCandidate(candidate({ mode: badMode }));
    assert.equal(result.ok, false, `mode ${JSON.stringify(badMode)} must be rejected`);
  }
});

// ---- D: malformed arrays ----

test("D: non-array fallbackOrder/enabledProviders/userSelectableProviders are rejected", () => {
  for (const field of ["fallbackOrder", "enabledProviders", "userSelectableProviders"]) {
    for (const badValue of ["anthropic", null, 42, { anthropic: true }]) {
      const result = validateProviderPolicyCandidate(candidate({ [field]: badValue }));
      assert.equal(result.ok, false, `${field}=${JSON.stringify(badValue)} must be rejected`);
    }
  }
});

// ---- E: unknown provider id -- explicit rejection contract ----

test("E: an unknown/future provider id anywhere in the arrays is rejected outright (not stripped, not normalized)", () => {
  for (const field of ["fallbackOrder", "enabledProviders", "userSelectableProviders"]) {
    for (const forged of ["gemini", "deepseek", "kimi", "local", "some-forged-id", "DROP TABLE"]) {
      const result = validateProviderPolicyCandidate(candidate({ [field]: [forged] }));
      assert.equal(result.ok, false, `${field} containing ${forged} must be rejected`);
    }
  }
});

test("E variant: defaultProvider set to an unknown/future provider id is rejected", () => {
  for (const forged of ["gemini", "deepseek", "kimi", "local", "not-a-provider"]) {
    const result = validateProviderPolicyCandidate(candidate({ defaultProvider: forged }));
    assert.equal(result.ok, false, `defaultProvider=${forged} must be rejected`);
  }
});

// ---- F: duplicate ids -- deterministic rejection ----

test("F: duplicate provider ids within an array are rejected (deterministic: reject, never silently de-duplicate)", () => {
  for (const field of ["fallbackOrder", "enabledProviders", "userSelectableProviders"]) {
    const result = validateProviderPolicyCandidate(candidate({ [field]: field === "userSelectableProviders" ? ["anthropic", "anthropic"] : ["anthropic", "openai", "anthropic"] }));
    assert.equal(result.ok, false, `duplicate ids in ${field} must be rejected`);
  }
});

// ---- G: selectable-not-enabled -- fail closed ----

test("G: userSelectableProviders not a subset of enabledProviders is rejected (fail closed)", () => {
  const result = validateProviderPolicyCandidate(candidate({ enabledProviders: ["anthropic"], userSelectableProviders: ["openai"] }));
  assert.equal(result.ok, false);
});

// ---- defaultProvider must be one of enabledProviders when non-null (chosen deterministic contract) ----

test("defaultProvider set but excluded from enabledProviders is rejected (chosen contract: reject, not silently normalize)", () => {
  const result = validateProviderPolicyCandidate(candidate({ enabledProviders: ["openai"], defaultProvider: "anthropic" }));
  assert.equal(result.ok, false);
});

test("defaultProvider null is always valid regardless of enabledProviders", () => {
  const result = validateProviderPolicyCandidate(candidate({ defaultProvider: null }));
  assert.equal(result.ok, true);
});

// ---- booleans ----

test("non-boolean allowUserSelection/fallbackEnabled are rejected", () => {
  for (const field of ["allowUserSelection", "fallbackEnabled"]) {
    for (const badValue of ["true", 1, null, undefined, "false"]) {
      const result = validateProviderPolicyCandidate(candidate({ [field]: badValue }));
      assert.equal(result.ok, false, `${field}=${JSON.stringify(badValue)} must be rejected`);
    }
  }
});

// ---- H: not an object at all ----

test("H: a completely malformed candidate (not an object, array, null, primitive) is rejected without throwing", () => {
  for (const bad of [null, undefined, "a string", 42, true, [], ["array", "not", "object"]]) {
    assert.doesNotThrow(() => validateProviderPolicyCandidate(bad));
    const result = validateProviderPolicyCandidate(bad);
    assert.equal(result.ok, false);
  }
});

// ---- I: DEFAULT_PROVIDER_POLICY is never mutated by validation ----

test("I: validating any candidate never mutates DEFAULT_PROVIDER_POLICY", () => {
  const before = JSON.parse(JSON.stringify(DEFAULT_PROVIDER_POLICY));
  validateProviderPolicyCandidate(candidate({ mode: "bogus" }));
  validateProviderPolicyCandidate(candidate());
  validateProviderPolicyCandidate({ garbage: true });
  assert.deepEqual(DEFAULT_PROVIDER_POLICY, before);
});

// ---- J: returned policy's arrays are fresh copies, never aliasing the candidate's arrays ----

test("J: a validated policy's arrays are frozen, independent copies -- mutating the original candidate cannot retroactively alter it", () => {
  const input = candidate();
  const result = validateProviderPolicyCandidate(input);
  assert.equal(result.ok, true);
  assert.ok(Object.isFrozen(result.policy.fallbackOrder));
  assert.ok(Object.isFrozen(result.policy.enabledProviders));
  assert.ok(Object.isFrozen(result.policy.userSelectableProviders));
  assert.notEqual(result.policy.fallbackOrder, input.fallbackOrder);
  input.fallbackOrder.push("openai", "openai"); // mutate the original after validation
  assert.deepEqual(result.policy.fallbackOrder, ["anthropic", "openai"], "already-returned policy must be unaffected by later mutation of the input");
});

test("validateProviderPolicyCandidate never throws for any candidate shape, including prototype-polluting attempts", () => {
  const weird = JSON.parse('{"mode":"AUTO","defaultProvider":null,"fallbackOrder":[],"enabledProviders":[],"userSelectableProviders":[],"allowUserSelection":false,"fallbackEnabled":true,"__proto__":{"polluted":true}}');
  assert.doesNotThrow(() => validateProviderPolicyCandidate(weird));
});
