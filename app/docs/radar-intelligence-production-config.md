# RADAR Intelligence — Production configuration (ops reference)

RADAR Intelligence adds an **opt-in, advisory** AI note on the prospect
detail page. It is **off by default** and the deterministic RADAR engine
is always the source of truth. This document is the configuration contract
for enabling the external provider in Production. It contains **no
secret**.

---

## Environment variables

Read **only** by `lib/radar-intelligence/config-loader.ts` — the single
`process.env` boundary in the intelligence layer. Nothing else reads them.

| Name | Values | Default | Meaning |
|---|---|---|---|
| `RADAR_INTELLIGENCE_ANTHROPIC_ENABLED` | `true` / `1` enables; anything else (unset, `""`, `false`, `TRUE`, `yes`, `on`, `0`) does not | *unset → disabled* | Master on/off for the external provider. |
| `RADAR_INTELLIGENCE_ANTHROPIC_API_KEY` | the provider secret | *unset → disabled* | Server-side credential. See rules below. |
| `RADAR_INTELLIGENCE_ANTHROPIC_MODEL` | a model id | `claude-sonnet-4-5` | Model selection. Config only — the provider **identity** stays `anthropic`. |

## Enabled-flag semantics (fail-closed)

`effectiveEnabled = (ENABLED is "true"/"1") AND (API_KEY is non-empty)`.

| `ENABLED` | `API_KEY` | Result |
|---|---|---|
| true | present | provider **may** be used — but only on an explicit user click |
| true | missing | **provider unavailable**, zero external call, app does not crash |
| false / unset | present | **provider unavailable**, zero external call |
| false / unset | missing | **provider unavailable** (Slice-1 behaviour) |

**Presence of the key alone never enables the provider.** The enable flag
is always required.

## Key rules (server-only)

- Set the key **only** in the server-side Production environment
  (Vercel Production env). Never Preview, never a committed file.
- The key is used **only** on the outbound `x-api-key` request header,
  inside `lib/radar-intelligence/adapters/anthropic-http-transport.ts`.
- The key is **never**: stored in the database, returned by any server
  action, shown in any UI (not even the last 4 characters), logged,
  included in telemetry, or persisted to the audit log.
- The operational status service (`getRadarIntelligenceProviderStatus`,
  `SYSTEM_ADMIN`-gated) exposes only `provider / connection / health /
  enabled / capabilities` — never the key, model, headers, or env.

## No automatic calls

The provider is invoked **only** by the `requestRadarIntelligenceAdvisory`
server action, which runs **only** when a user clicks "Obtenir un avis IA"
on the prospect detail page. It is never called on page load, per
prospect, during queue ranking, during assignment, during a follow-up
mutation, or in any background job. One click = exactly one provider
request (`maxRetries = 0`). A short in-memory per-user cooldown backstops
scripted callers; the browser never retries.

## No database / persistence

No migration, no provider-config table, no api-key table, no AI-result
table. The advisory is ephemeral component state — reloading the page
clears it. Telemetry carries only `requestId / provider / capability /
latencyMs / status / errorCode / usage` — never advisory text or prospect
context.

## Rollback / kill switch

To stop all new provider calls **without a code deploy**:

```
RADAR_INTELLIGENCE_ANTHROPIC_ENABLED=false   (or remove the variable)
```

New advisory requests immediately return `{ status: "unavailable" }`;
RADAR data is unaffected. **Removing `RADAR_INTELLIGENCE_ANTHROPIC_API_KEY`
also fails closed** — the provider becomes unavailable on the next
request. Either change alone is sufficient; no rebuild is required for the
env change to take effect on the next server invocation.

## What Production enablement does NOT include

Enabling the provider is scoped to the opt-in advisory button only. It
does not authorize automatic RADAR AI calls, background generation,
provider result persistence, an AI settings / provider-selector UI,
exposing provider internals to non-`SYSTEM_ADMIN` users, or any change to
the deterministic RADAR engine. Each is a separate review.
