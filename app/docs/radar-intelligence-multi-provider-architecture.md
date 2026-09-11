# RADAR Intelligence — Multi-provider architecture (V2 foundation)

RADAR Intelligence's opt-in AI advisory can now be served by **more than
one provider** (Anthropic, then OpenAI) without duplicating advisory
business logic, UI, or RBAC per provider. This document describes the
routing architecture, its safety invariants, and how to add a future
provider. It contains **no secret**.

---

## Non-negotiable invariant

The deterministic RADAR core — score, priority, confidence, recommended
action, assignment, queue ordering, tasks/follow-ups, CRM state, RBAC,
audit — works identically **with every AI provider disabled**. Nothing
described below changes that: the advisory is always a strictly additive,
non-authoritative annotation.

## Target architecture

```
RADAR Core (deterministic)
   -> RADAR Intelligence Gateway (lib/radar-intelligence/gateway.ts)
        -> Provider Router (lib/radar-intelligence/provider-router.ts)
             -> Anthropic Adapter   (adapters/anthropic.ts)
             -> OpenAI Adapter      (adapters/openai.ts)
        -> normalized IntelligenceAdvisory (same shape, either provider)
   -> existing Advisory Core (advisory-core.ts) / UI (unchanged)
```

Both adapters return the **same** normalized internal
`IntelligenceAdvisory` shape (`{ summary, risks, suggestedNextAction,
reasoning, usage, model, provider, ... }` — see `types.ts`). Advisory
business logic (structured-output parsing/cleaning, degradation to a
plain summary, the deterministic block, UI rendering, RBAC) lives ONCE,
upstream of the router — no per-provider branch anywhere outside an
adapter's own file.

## Provider ids and config

Provider identity is the literal string `"anthropic"` or `"openai"`
(`IntelligenceProviderId`, `types.ts`). Each provider reads its own,
independent env triplet (`config-loader.ts`, the only `process.env`
boundary in this layer):

| Provider | Enabled flag | API key | Model |
|---|---|---|---|
| Anthropic | `RADAR_INTELLIGENCE_ANTHROPIC_ENABLED` | `RADAR_INTELLIGENCE_ANTHROPIC_API_KEY` | `RADAR_INTELLIGENCE_ANTHROPIC_MODEL` |
| OpenAI | `RADAR_INTELLIGENCE_OPENAI_ENABLED` | `RADAR_INTELLIGENCE_OPENAI_API_KEY` | `RADAR_INTELLIGENCE_OPENAI_MODEL` |

Same fail-closed rule for both, independently: `effectiveEnabled =
(ENABLED is exactly "true"/"1") AND (API_KEY is non-empty)`. One
provider being off/misconfigured never affects the other. **OpenAI is
disabled by default** — enabling Anthropic alone changes nothing about
OpenAI's availability.

## Provider router: primary/fallback policy

`lib/radar-intelligence/provider-router.ts` is the ONE place that knows
there is a "primary" and a "fallback" provider. The default policy
(`DEFAULT_ROUTING_POLICY`) is:

- **Primary: Anthropic.**
- **Fallback: OpenAI.**

`createProviderRouter({ registry, policy, timeoutMs }).run(request)`:

1. Attempts the primary exactly once (via the existing gateway, scoped to
   that one provider through `isolateProvider`).
2. If the primary **succeeds**, returns its advisory. The fallback is
   never touched.
3. If the primary **fails**, checks `isFallbackEligible(error)`. Only on
   an eligible failure does it attempt the fallback, exactly once.
4. Returns the fallback's outcome (success or failure) if it ran,
   otherwise the primary's own failure outcome unchanged.

The router adds only the routing **decision** and two metadata fields
(`fallbackUsed`, `attemptCount`) on top of the gateway's existing
`IntelligenceOutcome` — it reimplements no HTTP, timeout, retry, or
normalization logic.

### Fallback eligibility — the exact rule

A fallback attempt is allowed **only** when the primary's failure means
"could not be reached or finished at all":

- `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`
- `PROVIDER_DISABLED` / `PROVIDER_DISCONNECTED` / `NO_CAPABLE_PROVIDER`
  (the primary simply isn't configured/registered)
- a genuine `PROVIDER_5XX` or `PROVIDER_NETWORK` failure class

A fallback is **never** attempted for:

- any 4xx (`400`/`401`/`403`/`404`/...) — a visible auth/config/validation
  mistake on the primary must stay visible, never silently papered over
  by a second billable call
- `429` rate-limiting — kept non-fallback in V2 (existing rate-limit
  semantics preserved)
- a local validation error (`INVALID_INTELLIGENCE_REQUEST`)
- an unparseable/malformed response (`PROVIDER_PARSE`)

**If Anthropic returns 401/403/400, OpenAI is never called automatically.**
This is deliberate: an authentication or configuration mistake must
remain visible in the diagnostic, not hidden behind a fallback success.

### No hidden retries

At most **one** call to the primary and **one** call to the fallback —
two provider dispatches total, ever, per advisory request. `run()` is a
single straight-line function with exactly two possible `gateway.run()`
call sites; there is no loop, no recursion, and no background retry.
This is verified by call-count assertions in `provider-router.test.mjs`
(every fake adapter counts its own invocations).

## Normalized error model (shared, provider-agnostic)

Both adapters route every failure through the same `errors.ts` machinery:
a stable `IntelligenceErrorCode`, an optional coarse `failureClass`
(`PROVIDER_4XX` / `PROVIDER_5XX` / `PROVIDER_TIMEOUT` / `PROVIDER_NETWORK`
/ `PROVIDER_PARSE` / `PROVIDER_UNKNOWN`), and an optional exact
`httpStatus` (validated 400–599, never fabricated). No provider-specific
raw error, SDK exception, or HTTP body ever escapes an adapter.

## Provider metadata (SYSTEM_ADMIN-only)

A successful advisory carries `providerMeta: { provider, model,
fallbackUsed }` — computed in `advisory-core.ts`, exposed **only** to a
`SYSTEM_ADMIN` caller by the existing allowlist-copy in
`lib/actions/radar-intelligence.ts::stripAdminOnlyFields` (unchanged code
path: a grown `providerMeta` shape passes through the same allowlist
boundary automatically). The UI renders it as:

```
Provider: Anthropic / Model: claude-sonnet-5 / Fallback used: No
Provider: OpenAI    / Model: gpt-4o-mini    / Fallback used: Yes
```

Never shown: an API key, raw request id, headers, provider response body,
token secrets, or internal ids.

## Observability (allowlisted, non-sensitive)

`logRadarIntelligenceEvent` (the single log choke point) accepts exactly
`source / code / failureClass / httpStatus / provider / fallbackUsed /
attempt / status` — each independently re-validated (`provider` against
the closed `IntelligenceProviderId` set, `fallbackUsed` as a strict
boolean, `attempt` as a small integer 0–2). Never logged: userId,
clientId, prospect data, prompt/response text, API keys, request headers,
internal UUIDs, or a raw `Error#message`/stack. A successful fallback
additionally logs one `FALLBACK_SUCCEEDED` event (`provider`,
`fallbackUsed: true`) — the one success-path event worth a line, since it
is otherwise indistinguishable from an ordinary primary success in the
plain UI result.

## Circuit-breaker foundation

The router deliberately does **not** implement a persistent, cross-request
circuit breaker in V2 — no DB table, no Redis. Each attempt still goes
through the existing per-process, in-memory circuit breaker
(`circuit-breaker.ts`) on the registry it's scoped to. The router's shape
(one function, one registry, one policy object) is designed so a future
persistent breaker can be inserted at the `isolateProvider`/`runOneAttempt`
seam without changing the router's public contract.

## Provider status (SYSTEM_ADMIN-only, configuration-only)

`getRadarIntelligenceProviderStatus()` reports, per known provider,
`connection / health / enabled / capabilities` and — on the real-config
path only — a `configured` boolean: whether a non-empty credential exists,
independent of the enabled flag. This lets an operator tell "off" apart
from "on but missing a key" apart from "off but a key exists", **without
any live credential test or health-check call** — `configured` is derived
purely from `loadRadarIntelligenceConfig()`'s parsed env state.

## Zero-provider mode

With both providers disabled/unconfigured, the router's primary attempt
resolves the gateway's existing `NO_CAPABLE_PROVIDER` → clean
deterministic outcome; the fallback is never attempted (nothing to be
eligible against). The UI shows `{ status: "unavailable" }`; RADAR's
deterministic core is fully unaffected. No exception, no provider call,
no routing loop.

## Adding a future provider (Gemini / DeepSeek / Kimi / Grok / local)

Adding provider N+1 touches **only**:

1. **Config** — one more `RADAR_INTELLIGENCE_<ID>_{ENABLED,API_KEY,MODEL}`
   triplet in `config-loader.ts`, following the exact Anthropic/OpenAI
   shape (`Loaded<Id>Config` + the two independent parse blocks).
2. **Adapter** — a new `adapters/<id>.ts` (+ `<id>-config.ts`,
   `<id>-transport.ts`, `<id>-http-transport.ts`, `<id>-request-builder.ts`,
   `<id>-response.ts`) implementing `IntelligenceProviderAdapter`, reusing
   the shared `structured-advisory-parser.ts` for output parsing so no
   business logic is duplicated.
3. **Registry** — one more `if (config.enabled) registry.register(...)`
   block in `adapters/index.ts`, and one more `if (p?.effectiveEnabled &&
   p.apiKey !== null) { ... }` block in `configured-registry.ts`.
4. **Routing policy** (optional) — a new named `RoutingPolicy` in
   `provider-router.ts` if the new provider should serve as a fallback for
   an existing one; `DEFAULT_ROUTING_POLICY` itself does not have to
   change.
5. **Tests** — mirroring the existing adapter/router/config-loader test
   files, with a fake transport (zero live calls).

`advisory-core.ts`, the UI component, deterministic RADAR, and RBAC
(`permissions.ts`) never need to change for a new provider.

## No database change

V2 is config + code only: no schema, no migration, no provider table, no
usage/cost table, no API-key table, no fallback-history table. Routing
metadata (`fallbackUsed`, `attemptCount`) is computed per-request and
never persisted.
