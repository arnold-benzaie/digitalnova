// RADAR INTELLIGENCE V1 — Slice 5 — server action orchestration tests.
//
// The advisory CORE (produceRadarAdvisory) is mocked here — its own logic
// is covered by lib/radar-intelligence/advisory-core.test.mjs. This file
// proves the "use server" action's contract:
//   - requireStaffMember("RADAR_QUEUE_VIEW") is the FIRST call; a denial
//     stops everything
//   - identity/scope come from the session only; the action takes just
//     (clientId) — no provider / model / userId / workspace parameter
//   - a per-user in-memory cooldown returns rate_limited on a fast repeat
//   - it delegates to produceRadarAdvisory with the real production deps
//     (getProspectQualification + a display loader + the configured registry)
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-intelligence.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/db", { namedExports: { db: {} } });

let permissionCalls = [];
let denyMode = false;
let evalCalls = [];
let evalOk = false;
let evalThrows = false;
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      permissionCalls.push(permission);
      if (denyMode) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return "EMPLOYEE";
    },
    // Non-redirecting SYSTEM_ADMIN check used to gate the operator
    // diagnostic. The action passes the SESSION userId (never a client arg).
    evaluateStaffPermission: async ({ userId, permission }) => {
      evalCalls.push({ userId, permission });
      if (evalThrows) {
        throw new Error("transient db error while re-checking SYSTEM_ADMIN");
      }
      return evalOk ? { ok: true, role: "ADMIN" } : { ok: false, reason: "permission-denied" };
    },
  },
});

let sessionUserId = "user-A";
mock.module("@/lib/session", { namedExports: { requireSession: async () => ({ userId: sessionUserId, role: "staff" }) } });

let localeCalls = [];
let currentLocale = "fr";
mock.module("@/lib/i18n/locale", {
  namedExports: {
    getLocale: async () => {
      localeCalls.push(currentLocale);
      return currentLocale;
    },
  },
});

mock.module("@/lib/actions/radar", { namedExports: { getProspectQualification: async () => ({ qualificationStatus: "QUALIFIED", eligibility: { contactable: true }, opportunity: null }) } });

/** @type {string[]} RADAR INTELLIGENCE V2.1 Phase D — registered provider
 * ids for getRadarAiProviderSelectionOptions()'s own registry read.
 * Defaults to empty (pre-Phase-D behavior: no test relied on a non-empty
 * registry from this mock). */
let registeredProviderIds = [];
/** @type {Array<Record<string, unknown>>} RADAR INTELLIGENCE V2.1 Phase E
 * — every deps object this factory was actually called with, so a test
 * can prove what `requestRadarIntelligenceAdvisory`'s `createRegistry`
 * closure passes through (in particular `modelOverrides`). */
let configuredRegistryCalls = [];
mock.module("@/lib/radar-intelligence/configured-registry", {
  namedExports: {
    createConfiguredRadarIntelligenceRegistry: (deps = {}) => {
      configuredRegistryCalls.push(deps);
      return {
        list: () => registeredProviderIds.map((id) => ({ id })),
        selectProvider: () => ({ ok: false, error: { code: "NO_CAPABLE_PROVIDER" } }),
      };
    },
  },
});

/** @type {{ allowUserSelection: boolean; userSelectableProviders: string[] }}
 * RADAR INTELLIGENCE V2.1 Phase D — the OWNER policy
 * getRadarAiProviderSelectionOptions() reads. Defaults to the safe,
 * selection-disabled shape (matches DEFAULT_PROVIDER_POLICY). */
let ownerPolicyMock = { allowUserSelection: false, userSelectableProviders: [] };
mock.module("@/lib/radar-intelligence/provider-policy-store", {
  namedExports: { loadProviderPolicy: async () => ownerPolicyMock },
});

/** @type {Record<string, string>} RADAR INTELLIGENCE V2.1 Phase E — kept
 * empty by default: this suite tests the ACTION's orchestration, not the
 * runtime-config store (see provider-runtime-config-store.test.mjs for
 * that) — mocked here, same as provider-policy-store above, so the
 * fake db ({}) is never actually touched and this store's own fallback
 * console.warn never fires and pollutes withCapturedWarn() below. */
let modelOverridesMock = {};
mock.module("@/lib/radar-intelligence/provider-runtime-config-store", {
  namedExports: { loadProviderModelOverrides: async () => modelOverridesMock },
});

let coreCalls = [];
let coreResult = { status: "unavailable" };
let coreThrows = false;
mock.module("@/lib/radar-intelligence/advisory-core", {
  namedExports: {
    produceRadarAdvisory: async (clientId, deps, requestedProviderId) => {
      coreCalls.push({ clientId, depKeys: Object.keys(deps).sort(), locale: deps.locale, requestedProviderId });
      // Real produceRadarAdvisory always calls deps.createRegistry() —
      // invoke it here too so the (real) closure built by
      // requestRadarIntelligenceAdvisory actually runs, letting
      // configuredRegistryCalls observe what it passed through.
      deps.createRegistry();
      if (coreThrows) {
        throw new Error("unexpected core failure with a secret inside sk-ant-LEAK");
      }
      return coreResult;
    },
  },
});

const { requestRadarIntelligenceAdvisory, getRadarAiProviderSelectionOptions } = await import("./radar-intelligence.ts");

const CLIENT = "22222222-2222-4222-8222-222222222222";

function reset() {
  permissionCalls = [];
  denyMode = false;
  coreCalls = [];
  evalCalls = [];
  evalOk = false;
  evalThrows = false;
  coreResult = { status: "unavailable" };
  coreThrows = false;
  sessionUserId = `user-${Math.random().toString(36).slice(2)}`;
  localeCalls = [];
  currentLocale = "fr";
  registeredProviderIds = [];
  ownerPolicyMock = { allowUserSelection: false, userSelectableProviders: [] };
  modelOverridesMock = {};
  configuredRegistryCalls = [];
}

async function withCapturedWarn(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => {
    calls.push(args);
  };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

test("action: requireStaffMember('RADAR_QUEUE_VIEW') runs first; delegates to the core with production deps", async () => {
  reset();
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.equal(coreCalls.length, 1);
  assert.equal(coreCalls[0].clientId, CLIENT);
  assert.deepEqual(coreCalls[0].depKeys, ["createRegistry", "loadDisplayContext", "loadQualification", "locale"].sort());
  assert.deepEqual(r, { status: "unavailable" });
});

test("action: a guard denial propagates — core never runs", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => requestRadarIntelligenceAdvisory(CLIENT), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.equal(coreCalls.length, 0);
});

test("action: signature is (clientId, requestedProviderId?) — the second parameter is a request-scoped provider PREFERENCE, still no model / userId / workspace parameter", () => {
  // RADAR INTELLIGENCE V2.1 Phase D: the action gained one optional
  // parameter. This is a conscious, reviewed contract change, not a
  // relaxed test — the invariant that actually matters (no identity /
  // role / workspace / model parameter) is asserted explicitly by the
  // dedicated Phase D tests further below, which prove the raw value is
  // narrowed to a known provider id or discarded before ever reaching
  // the core.
  assert.equal(requestRadarIntelligenceAdvisory.length, 2);
});

test("action: per-user cooldown — a fast repeat for the SAME session user returns rate_limited without calling the core", async () => {
  reset();
  sessionUserId = "cooldown-user";
  const first = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(first, { status: "unavailable" });
  const second = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(second, { status: "rate_limited" });
  assert.equal(coreCalls.length, 1, "the core ran only once");
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW", "RADAR_QUEUE_VIEW"], "auth still runs on the throttled call");
});

test("action: a different session user is not throttled by another user's recent request", async () => {
  reset();
  sessionUserId = "user-X";
  await requestRadarIntelligenceAdvisory(CLIENT);
  sessionUserId = "user-Y";
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, { status: "unavailable" });
  assert.equal(coreCalls.length, 2);
});

// ---------------- operator diagnostic: SYSTEM_ADMIN-only exposure ----------------

test("diagnostic: a SYSTEM_ADMIN caller receives the coarse failure class verbatim", async () => {
  reset();
  evalOk = true;
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX" };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, { status: "error", diagnostic: "PROVIDER_4XX" });
  // gated by the SYSTEM_ADMIN permission, checked against the SESSION id
  assert.equal(evalCalls.length, 1);
  assert.equal(evalCalls[0].permission, "SYSTEM_ADMIN");
  assert.equal(evalCalls[0].userId, sessionUserId);
});

for (const label of ["MANAGER", "EMPLOYEE", "any non-admin"]) {
  test(`diagnostic: a ${label} caller gets the safe result with the diagnostic STRIPPED`, async () => {
    reset();
    evalOk = false; // evaluateStaffPermission denies SYSTEM_ADMIN
    coreResult = { status: "error", diagnostic: "PROVIDER_5XX" };
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.deepEqual(r, { status: "error" });
    assert.equal("diagnostic" in r, false);
    assert.equal(evalCalls.length, 1, "the SYSTEM_ADMIN check still ran");
    assert.equal(evalCalls[0].permission, "SYSTEM_ADMIN");
  });
}

// ---------------- exact HTTP status: same SYSTEM_ADMIN-only exposure boundary as diagnostic ----------------

test("httpStatus: a SYSTEM_ADMIN caller receives BOTH diagnostic and httpStatus verbatim", async () => {
  reset();
  evalOk = true;
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX", httpStatus: 400 };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, { status: "error", diagnostic: "PROVIDER_4XX", httpStatus: 400 });
});

test("httpStatus: an ADMIN caller (SYSTEM_ADMIN=true, matching the current permission matrix) also receives both fields", async () => {
  reset();
  evalOk = true; // the mock returns { ok: true, role: "ADMIN" } — see the rbac mock above
  coreResult = { status: "unavailable", diagnostic: "PROVIDER_5XX", httpStatus: 503 };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, { status: "unavailable", diagnostic: "PROVIDER_5XX", httpStatus: 503 });
});

for (const label of ["MANAGER", "EMPLOYEE", "any non-admin"]) {
  test(`httpStatus: a ${label} caller gets the safe result with BOTH diagnostic and httpStatus STRIPPED`, async () => {
    reset();
    evalOk = false;
    coreResult = { status: "error", diagnostic: "PROVIDER_4XX", httpStatus: 401 };
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.deepEqual(r, { status: "error" });
    assert.equal("diagnostic" in r, false);
    assert.equal("httpStatus" in r, false);
  });
}

test("httpStatus: the permission-check THROWING strips BOTH diagnostic and httpStatus (goal 4 covers httpStatus too)", async () => {
  reset();
  evalThrows = true;
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX", httpStatus: 429 };
  const calls = await withCapturedWarn(async () => {
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.deepEqual(r, { status: "error" });
    assert.equal("diagnostic" in r, false);
    assert.equal("httpStatus" in r, false);
  });
  assert.deepEqual(calls[0][1], { source: "diagnostic_permission_check", code: "SYSTEM_ADMIN_CHECK_FAILED", status: "error" });
  assert.equal("httpStatus" in calls[0][1], false, "the failure of the CHECK itself never carries a provider httpStatus");
});

test("httpStatus: a failure with NO genuine HTTP status (e.g. timeout) never fabricates one, even for SYSTEM_ADMIN", async () => {
  reset();
  evalOk = true;
  coreResult = { status: "timeout", diagnostic: "PROVIDER_TIMEOUT" };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, { status: "timeout", diagnostic: "PROVIDER_TIMEOUT" });
  assert.equal("httpStatus" in r, false);
});

test("diagnostic: the SYSTEM_ADMIN check is SKIPPED when the core result has no diagnostic (common path, no extra RBAC hit)", async () => {
  reset();
  evalOk = true;
  coreResult = { status: "unavailable" };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, { status: "unavailable" });
  assert.equal(evalCalls.length, 0);
});

test("diagnostic: an OK advisory is passed straight through — never carries or triggers a diagnostic", async () => {
  reset();
  evalOk = true;
  coreResult = {
    status: "ok",
    summary: "text",
    suggestedNextAction: null,
    generatedAt: "2026-09-13T10:00:00.000Z",
    deterministic: { priority: "HIGH", confidence: "MEDIUM", recommendedNextAction: "FOLLOW_UP_PROPOSAL" },
  };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.equal(r.status, "ok");
  assert.equal("diagnostic" in r, false);
  assert.equal(evalCalls.length, 0);
});

test("diagnostic: RADAR_QUEUE_VIEW is still the FIRST gate; the SYSTEM_ADMIN check is additive and never widens access", async () => {
  reset();
  denyMode = true; // requireStaffMember("RADAR_QUEUE_VIEW") denies
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX" };
  await assert.rejects(() => requestRadarIntelligenceAdvisory(CLIENT), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.equal(coreCalls.length, 0, "core never ran");
  assert.equal(evalCalls.length, 0, "no diagnostic gating on a denied request");
});

// ---------------- observability hardening: the SYSTEM_ADMIN re-check itself failing ----------------

test("hardening: the SYSTEM_ADMIN check THROWING returns the safe status, never the diagnostic", async () => {
  reset();
  evalThrows = true;
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX" };
  const calls = await withCapturedWarn(async () => {
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.deepEqual(r, { status: "error" });
    assert.equal("diagnostic" in r, false);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { source: "diagnostic_permission_check", code: "SYSTEM_ADMIN_CHECK_FAILED", status: "error" });
});

test("hardening: the SYSTEM_ADMIN check THROWING does not reject the whole server action (goal 4)", async () => {
  reset();
  evalThrows = true;
  coreResult = { status: "unavailable", diagnostic: "PROVIDER_5XX" };
  // assert.doesNotReject proves requestRadarIntelligenceAdvisory resolves
  // — the promise is fulfilled with a safe value, not rejected.
  await assert.doesNotReject(async () => {
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.deepEqual(r, { status: "unavailable" });
  });
});

test("hardening: the SYSTEM_ADMIN-check-failure log carries only the allowlisted fields, no userId/clientId/stack", async () => {
  reset();
  evalThrows = true;
  sessionUserId = "user-should-not-appear-in-any-log";
  coreResult = { status: "timeout", diagnostic: "PROVIDER_TIMEOUT" };
  const calls = await withCapturedWarn(() => requestRadarIntelligenceAdvisory(CLIENT));
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["code", "source", "status"]);
  const s = JSON.stringify(calls[0]);
  assert.equal(s.includes("user-should-not-appear-in-any-log"), false);
  assert.equal(s.includes(CLIENT), false);
  assert.equal(s.includes("transient db error"), false, "the raw thrown error message must never be logged");
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s), false);
});

test("hardening: when evaluateStaffPermission does NOT throw, no server_action_boundary/permission-check log is emitted", async () => {
  reset();
  evalOk = true;
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX" };
  const calls = await withCapturedWarn(async () => {
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.deepEqual(r, { status: "error", diagnostic: "PROVIDER_4XX" });
  });
  assert.equal(calls.length, 0);
});

test("hardening: existing OWNER/ADMIN (SYSTEM_ADMIN=true) vs MANAGER/EMPLOYEE (SYSTEM_ADMIN=false) exposure is unchanged", async () => {
  reset();
  evalOk = true;
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX" };
  const admin = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(admin, { status: "error", diagnostic: "PROVIDER_4XX" });

  reset();
  evalOk = false;
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX" };
  const nonAdmin = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(nonAdmin, { status: "error" });
});

test("hardening: an unexpected throw from the core itself resolves to the safe error status (never rejects), logged via server_action_boundary, no raw exception text", async () => {
  reset();
  coreThrows = true;
  const calls = await withCapturedWarn(async () => {
    await assert.doesNotReject(async () => {
      const r = await requestRadarIntelligenceAdvisory(CLIENT);
      assert.deepEqual(r, { status: "error" });
    });
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { source: "server_action_boundary", code: "SERVER_ACTION_UNHANDLED_ERROR", status: "error" });
  const s = JSON.stringify(calls);
  assert.equal(s.includes("sk-ant-LEAK"), false);
  assert.equal(s.includes("unexpected core failure"), false);
});

test("hardening: a REDIRECT throw from requireStaffMember still propagates untouched — the outer catch never swallows an auth redirect", async () => {
  reset();
  denyMode = true;
  const calls = await withCapturedWarn(async () => {
    await assert.rejects(() => requestRadarIntelligenceAdvisory(CLIENT), /NEXT_REDIRECT/);
  });
  assert.equal(calls.length, 0, "no observability log fires for a normal auth redirect");
});

// ---------------- V1.1: locale is resolved server-side, never client-supplied ----------------

test("locale: the action's own resolved locale is threaded into the core deps — the action still takes only (clientId)", async () => {
  reset();
  currentLocale = "en";
  await requestRadarIntelligenceAdvisory(CLIENT);
  assert.equal(localeCalls.length, 1, "getLocale() is called exactly once");
  assert.equal(coreCalls[0].locale, "en");
  assert.equal(requestRadarIntelligenceAdvisory.length, 2, "signature is (clientId, requestedProviderId?)");
});

test("locale: FR is the default when the app's current locale resolves to fr", async () => {
  reset();
  currentLocale = "fr";
  await requestRadarIntelligenceAdvisory(CLIENT);
  assert.equal(coreCalls[0].locale, "fr");
});

// ---------------- V1.1: providerMeta follows the EXACT same SYSTEM_ADMIN boundary as diagnostic ----------------

const OK_WITH_META = {
  status: "ok",
  summary: "text",
  suggestedNextAction: "Send a recap",
  risks: ["Budget uncertain"],
  reasoning: "Grounded in the recent interaction.",
  generatedAt: "2026-09-13T10:00:00.000Z",
  deterministic: { priority: "HIGH", confidence: "MEDIUM", recommendedNextAction: "FOLLOW_UP_PROPOSAL" },
  providerMeta: { provider: "anthropic", model: "claude-sonnet-5" },
};

test("providerMeta: SYSTEM_ADMIN receives providerMeta verbatim, alongside every other ok field", async () => {
  reset();
  evalOk = true;
  coreResult = OK_WITH_META;
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, OK_WITH_META);
  assert.equal(evalCalls.length, 1);
  assert.equal(evalCalls[0].permission, "SYSTEM_ADMIN");
});

for (const label of ["MANAGER", "EMPLOYEE", "any non-admin"]) {
  test(`providerMeta: a ${label} caller keeps every ok field EXCEPT providerMeta`, async () => {
    reset();
    evalOk = false;
    coreResult = OK_WITH_META;
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.equal("providerMeta" in r, false);
    assert.deepEqual(r, {
      status: "ok",
      summary: OK_WITH_META.summary,
      suggestedNextAction: OK_WITH_META.suggestedNextAction,
      risks: OK_WITH_META.risks,
      reasoning: OK_WITH_META.reasoning,
      generatedAt: OK_WITH_META.generatedAt,
      deterministic: OK_WITH_META.deterministic,
    });
  });
}

test("providerMeta: the SYSTEM_ADMIN check is SKIPPED when the ok result has no providerMeta (common path, no extra RBAC hit)", async () => {
  reset();
  evalOk = true;
  coreResult = { status: "ok", summary: "x", suggestedNextAction: null, risks: [], reasoning: null, generatedAt: "2026-09-13T10:00:00.000Z", deterministic: { priority: "LOW", confidence: "LOW", recommendedNextAction: "NONE" } };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, coreResult);
  assert.equal(evalCalls.length, 0);
});

// ---------------- V2: providerMeta.fallbackUsed follows the exact same boundary ----------------

const OK_WITH_FALLBACK_META = {
  ...OK_WITH_META,
  providerMeta: { provider: "openai", model: "gpt-4o-mini", fallbackUsed: true },
};

test("V2: SYSTEM_ADMIN sees fallbackUsed inside providerMeta verbatim (no production code needed — the field passes through the existing allowlist boundary)", async () => {
  reset();
  evalOk = true;
  coreResult = OK_WITH_FALLBACK_META;
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, OK_WITH_FALLBACK_META);
  assert.equal(r.providerMeta.fallbackUsed, true);
  assert.equal(r.providerMeta.provider, "openai");
});

for (const label of ["MANAGER", "EMPLOYEE", "any non-admin"]) {
  test(`V2: a ${label} caller never sees fallbackUsed (or provider/model) — providerMeta is stripped entirely regardless of its shape`, async () => {
    reset();
    evalOk = false;
    coreResult = OK_WITH_FALLBACK_META;
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.equal("providerMeta" in r, false);
    const s = JSON.stringify(r);
    assert.equal(s.includes("fallbackUsed"), false);
    assert.equal(s.includes("openai"), false);
    assert.equal(s.includes("gpt-4o-mini"), false);
  });
}

test("providerMeta: a permission-check THROW strips providerMeta but keeps every other ok field (not just the diagnostic path)", async () => {
  reset();
  evalThrows = true;
  coreResult = OK_WITH_META;
  const calls = await withCapturedWarn(async () => {
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.equal("providerMeta" in r, false);
    assert.equal(r.summary, OK_WITH_META.summary);
    assert.deepEqual(r.risks, OK_WITH_META.risks);
    assert.equal(r.reasoning, OK_WITH_META.reasoning);
  });
  assert.deepEqual(calls[0][1], { source: "diagnostic_permission_check", code: "SYSTEM_ADMIN_CHECK_FAILED", status: "ok" });
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase D: requestedProviderId passthrough +
// getRadarAiProviderSelectionOptions()
// =====================================================================

test("Phase D: a valid requestedProviderId ('openai') is narrowed and forwarded verbatim to the core as the third argument", async () => {
  reset();
  await requestRadarIntelligenceAdvisory(CLIENT, "openai");
  assert.equal(coreCalls[0].requestedProviderId, "openai");
});

test("Phase D: a valid requestedProviderId ('anthropic') is forwarded verbatim", async () => {
  reset();
  await requestRadarIntelligenceAdvisory(CLIENT, "anthropic");
  assert.equal(coreCalls[0].requestedProviderId, "anthropic");
});

test("Phase D: omitted requestedProviderId -> the core receives null, never undefined-as-a-distinguishing-signal, never a throw", async () => {
  reset();
  await requestRadarIntelligenceAdvisory(CLIENT);
  assert.equal(coreCalls[0].requestedProviderId, null);
});

for (const forged of ["gemini", "deepseek", "kimi", "local", "deterministic", "DROP TABLE", "", "anthropic; openai", "__proto__"]) {
  test(`Phase D: a forged/unsupported requestedProviderId (${JSON.stringify(forged)}) is coerced to null BEFORE reaching the core -- never passed through raw`, async () => {
    reset();
    await requestRadarIntelligenceAdvisory(CLIENT, forged);
    assert.equal(coreCalls[0].requestedProviderId, null, `forged value ${JSON.stringify(forged)} must never reach the core as-is`);
  });
}

test("Phase D: a non-string requestedProviderId (number, object, array) is coerced to null, never throws", async () => {
  reset();
  for (const bad of [42, {}, [], true]) {
    await assert.doesNotReject(() => requestRadarIntelligenceAdvisory(CLIENT, bad));
    assert.equal(coreCalls[coreCalls.length - 1].requestedProviderId, null);
  }
});

test("Phase D: requestedProviderId never changes the permission requested -- still exactly RADAR_QUEUE_VIEW, no escalation", async () => {
  reset();
  await requestRadarIntelligenceAdvisory(CLIENT, "openai");
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
});

// ---------------- getRadarAiProviderSelectionOptions() ----------------

test("getRadarAiProviderSelectionOptions: requires RADAR_QUEUE_VIEW -- the SAME permission as the advisory itself, no escalation", async () => {
  reset();
  const result = await getRadarAiProviderSelectionOptions();
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.deepEqual(result, { selectableProviders: [] });
});

test("getRadarAiProviderSelectionOptions: a guard denial propagates, same as the advisory action", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => getRadarAiProviderSelectionOptions(), /NEXT_REDIRECT/);
});

test("getRadarAiProviderSelectionOptions: allowUserSelection=false -> empty array regardless of userSelectableProviders content", async () => {
  reset();
  ownerPolicyMock = { allowUserSelection: false, userSelectableProviders: ["anthropic", "openai"] };
  registeredProviderIds = ["anthropic", "openai"];
  const result = await getRadarAiProviderSelectionOptions();
  assert.deepEqual(result.selectableProviders, []);
});

test("getRadarAiProviderSelectionOptions: allowUserSelection=true + both registered -> both surfaced", async () => {
  reset();
  ownerPolicyMock = { allowUserSelection: true, userSelectableProviders: ["anthropic", "openai"] };
  registeredProviderIds = ["anthropic", "openai"];
  const result = await getRadarAiProviderSelectionOptions();
  assert.deepEqual(result.selectableProviders.sort(), ["anthropic", "openai"]);
});

test("getRadarAiProviderSelectionOptions: a policy-selectable provider that is NOT registered is filtered out", async () => {
  reset();
  ownerPolicyMock = { allowUserSelection: true, userSelectableProviders: ["anthropic", "openai"] };
  registeredProviderIds = ["anthropic"]; // openai selectable by policy but not technically configured
  const result = await getRadarAiProviderSelectionOptions();
  assert.deepEqual(result.selectableProviders, ["anthropic"]);
});

test("getRadarAiProviderSelectionOptions: an unrecognized id smuggled into userSelectableProviders (defensive) never leaks through", async () => {
  reset();
  ownerPolicyMock = { allowUserSelection: true, userSelectableProviders: ["gemini", "anthropic"] };
  registeredProviderIds = ["anthropic"];
  const result = await getRadarAiProviderSelectionOptions();
  assert.deepEqual(result.selectableProviders, ["anthropic"]);
});

test("getRadarAiProviderSelectionOptions: no registered providers -> empty array, never throws", async () => {
  reset();
  ownerPolicyMock = { allowUserSelection: true, userSelectableProviders: ["anthropic", "openai"] };
  registeredProviderIds = [];
  const result = await getRadarAiProviderSelectionOptions();
  assert.deepEqual(result.selectableProviders, []);
});

test("getRadarAiProviderSelectionOptions: never triggers a provider call -- read-only, zero adapter interaction", async () => {
  reset();
  ownerPolicyMock = { allowUserSelection: true, userSelectableProviders: ["anthropic", "openai"] };
  registeredProviderIds = ["anthropic", "openai"];
  await getRadarAiProviderSelectionOptions();
  assert.equal(coreCalls.length, 0, "the advisory core must never run for a selection-options read");
});

// ---------------- RADAR INTELLIGENCE V2.1 Phase E: model override wiring ----------------
//
// `requestRadarIntelligenceAdvisory` loads any OWNER-configured model
// override ONCE (async), then builds a synchronous `createRegistry`
// closure that forwards it into `createConfiguredRadarIntelligenceRegistry`.
// These tests observe that wiring directly via `configuredRegistryCalls`.

test("Phase E: a stored model override is forwarded into createConfiguredRadarIntelligenceRegistry({ modelOverrides })", async () => {
  reset();
  modelOverridesMock = { anthropic: "claude-sonnet-5" };
  await requestRadarIntelligenceAdvisory(CLIENT);
  assert.equal(configuredRegistryCalls.length, 1);
  assert.deepEqual(configuredRegistryCalls[0].modelOverrides, { anthropic: "claude-sonnet-5" });
});

test("Phase E: no stored override -> createConfiguredRadarIntelligenceRegistry is still called with an empty modelOverrides object, never omitted/undefined-shaped", async () => {
  reset();
  modelOverridesMock = {};
  await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(configuredRegistryCalls[0].modelOverrides, {});
});

test("Phase E: model overrides are loaded fresh on every call -- two requests can see two different override states", async () => {
  reset();
  // Distinct session user ids so the action's own per-user cooldown
  // (unrelated to this feature) never turns the second call into an
  // early rate_limited return before createRegistry is ever built.
  sessionUserId = "user-phase-e-1";
  modelOverridesMock = { anthropic: "claude-sonnet-5" };
  await requestRadarIntelligenceAdvisory(CLIENT);
  sessionUserId = "user-phase-e-2";
  modelOverridesMock = { openai: "gpt-5.6-terra" };
  await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(configuredRegistryCalls[0].modelOverrides, { anthropic: "claude-sonnet-5" });
  assert.deepEqual(configuredRegistryCalls[1].modelOverrides, { openai: "gpt-5.6-terra" });
});

test("Phase E: getRadarAiProviderSelectionOptions never reads or forwards model overrides -- it only checks registration, unaffected by this feature", async () => {
  reset();
  modelOverridesMock = { anthropic: "claude-sonnet-5" };
  registeredProviderIds = ["anthropic", "openai"];
  ownerPolicyMock = { allowUserSelection: true, userSelectableProviders: ["anthropic", "openai"] };
  await getRadarAiProviderSelectionOptions();
  assert.equal(configuredRegistryCalls.length, 1);
  assert.equal("modelOverrides" in configuredRegistryCalls[0], false);
});
