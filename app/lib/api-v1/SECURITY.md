# `/api/v1` — security decisions

Covers Étape 1 (authentication foundations) through Étape 5 (rate limiting + quotas). See the plan document for what ships later.

## Why a separate auth path from the rest of the app

Every other route in this app is gated by a real, signed-in Clerk session (`lib/session.ts`, `lib/dev-role.ts`) — a human PUBLIC-MAP staff member. `/api/v1` is called by machines on behalf of an *external* organization (n8n, Make, Zapier, Airtable, a custom client) that has no Clerk identity at all. Mixing the two auth models would be a mistake: `proxy.ts` therefore excludes `/api/v1(.*)` from `auth.protect()` entirely — the same treatment already given to `/api/webhooks(.*)` and `/api/cron(.*)`, which also verify their own secret rather than relying on Clerk — and `authenticateApiRequest()` in `lib/api-v1/auth.ts` is the *only* gate every `/api/v1` route calls. Nothing else under `/api/**` was added to the public-route list; `/api/v1(.*)` is scoped to that one prefix.

## Key parsing is position-based, never delimiter-based

A real key looks like `pm_{live|test}_{lookupId}_{secret}`. Both `lookupId` (12 chars) and `secret` (43 chars) are base64url-encoded (`lib/integrations/crypto.ts`'s `generateIntegrationApiKey`), and base64url's alphabet includes `_`. A parser that does `key.split("_")` would silently misparse any key whose secret happens to contain an underscore — which is common, not an edge case (base64url draws from a 64-symbol alphabet including `_`, so roughly 1 in 64 characters of a real secret is `_`, meaning most real secrets contain several).

`parseApiKey()` instead slices by fixed, known position: `pm_` (3 chars) → environment word (`live`/`test`, checked by exact `startsWith` match, not scanned for) → a literal `_` → exactly 12 characters (the lookupId, whatever they contain) → a literal `_` → everything remaining is the secret. It never searches for a delimiter inside the parts that are allowed to contain one. Verified directly: `auth.test.mjs`'s "never uses delimiter-splitting" test constructs a key whose secret is nothing but repeated underscores and confirms it still parses correctly.

## No existence oracle on the API key itself

Two distinct failure conditions — "no row has this `lookupId`" and "a row exists but the presented secret doesn't hash to its stored `keyHash`" — are collapsed into the **same** `INVALID_API_KEY` code and message. If they were distinguishable, an attacker could enumerate valid `lookupId`s (and therefore valid key prefixes) by timing or by response content alone, without ever knowing a real secret.

To close the *timing* side of this (not just the message), a lookup miss still runs a full HMAC comparison — against a fixed, unmatchable decoy hash — instead of short-circuiting immediately. `verifyIntegrationApiKey()` (`lib/integrations/crypto.ts`) already uses `timingSafeEqual` for the comparison itself; the addition here is making sure that comparison *always runs*, on both branches, rather than being skipped when the row isn't found.

Once the secret *does* verify — proof the caller genuinely holds that exact key — later rejections (revoked, expired, integration inactive/expired, missing scope) get their own specific codes. That's intentionally not folded into the same generic bucket: only someone who already possesses the real key can ever reach that branch, so telling them *why* it's now rejected is useful, not a leak.

## Organization isolation cannot be spoofed by the request

`authenticateApiRequest()` returns `organizationId` (and `integrationId`, `apiKeyId`) derived **exclusively** from a server-side join — `integration_api_keys.integration_id → integrations.id → integrations.organization_id` — anchored on the row found via the verified key. No header, query parameter, or request body field is ever consulted for this value. `auth.integration.test.mjs` proves this directly: a request carrying a spoofed `X-Organization-Id` header still resolves to the true organization the key belongs to. Every future `/api/v1` route must treat `context.organizationId` as the *only* legitimate scope for its queries — never a client-supplied id.

## What "active" requires — checked on both sides of the relationship

A request is only authenticated if **all** of the following hold, checked in this order (cheapest/most information-hiding checks first): the key is found and its secret verifies; `integration_api_keys.status === "active"`; the key's `expiresAt` is null or in the future; the owning `integrations.status === "active"`; the integration's `expiresAt` is null or in the future; and, if the route requires one, the key's `scopes` array contains it. A key can be perfectly valid on its own and still rejected because the *integration* that owns it was disabled or expired — mirrors the same two-level check already used by `createWebhookEndpoint()`.

## `lastUsedAt` — success only

`integration_api_keys.last_used_at` is updated in exactly one place, on the success path, after every other check has passed — never on a rejected attempt, and it's `await`ed rather than fired-and-forgotten (an un-awaited write in a serverless function risks being cut off the moment the response is sent).

## Failure logging never records the key

Every rejection calls `logAudit()` (`action: "api_v1.auth_failed"`) with the failure code, the route, and — if the key parsed successfully — its `keyPrefix` only (`pm_live_{lookupId}`, already treated as public/non-secret everywhere else in this feature, e.g. displayed in the admin UI's API Keys list). The presented key's secret portion, and the full raw key string, are never passed to `logAudit()` in any form. `auth.integration.test.mjs` asserts this directly by serializing the logged metadata and checking neither the full key nor its secret substring appears in it. A logging failure itself is swallowed (`.catch()`) so a broken audit write can never turn into a 500 for a caller who was correctly rejected.

## Normalized error envelope

Every `/api/v1` response — success or failure — carries an `X-Request-Id` header. Error bodies are `{"error": {"code": "SCREAMING_SNAKE_CASE", "message": "...", "requestId": "..."}}` with a matching HTTP status (401 for anything auth-shaped, 403 for a missing scope, 503 if `INTEGRATION_API_KEY_PEPPER` isn't configured, 500 — with no internal detail — for anything unexpected). This is the first standardized error convention in this repo's `app/api/**` tree; every pre-existing route returns ad hoc plain-text bodies with inconsistent success keys (see the plan document for the survey). `handleApiError()` in `lib/api-v1/response.ts` is the single place this mapping happens, so every future `/api/v1` route stays consistent by construction rather than by convention alone.

## Write-scoped isolation: a referenced `clientId` gets the same treatment as a URL `:id`

`POST /tasks` and `POST /interactions` both take a `clientId` in the body, not the URL — but the isolation guarantee is identical: `getClientForOrg(context.organizationId, clientId)` (the exact function GET/PATCH `/clients/:id` already uses) must return a row or the whole request is rejected. The rejection is a generic `VALIDATION_ERROR`, deliberately not distinguishing "no such client" from "that client belongs to someone else" — same anti-enumeration principle as the identical-404 behavior elsewhere, just surfaced as 400 instead of 404 because the bad reference lives in the request body, not the URL path.

## Fields no client input can ever set

Every create/update route in this API (`clients:update`, `tasks:create`, `interactions:create`) validates its body against an explicit whitelist and rejects the **entire** request — never silently drops fields — if it contains anything outside that whitelist. `id`, `organizationId`, and every `createdAt`/system field are never on any whitelist, on any route. Two fields get special handling because the schema itself supports them but they name *PUBLIC-MAP-internal* attribution, not the tenant's own data: `crmClients.ownerName` (Étape 3) and `tasks.assignee` are never settable *or readable* through this API at all; `interactions.createdBy` is populated **server-side** from the API key (`api:{keyPrefix}` — the same non-secret identifier already safe to log) and is likewise never accepted from the request nor echoed back in the response. A caller cannot make PUBLIC-MAP's internal CRM operations point at whatever it wants, in either direction.

## Idempotency (`Idempotency-Key`)

Opt-in, not mandatory — a write without the header just creates a new resource every time, as always. When present, `lib/api-v1/idempotency.ts` enforces: a retry with the *same* key and the *same* request body (compared via a canonical, key-order-independent SHA-256 hash — see `hashRequestBody`, which sorts object keys recursively before hashing so two requests that differ only in JSON key order aren't wrongly treated as different content) replays the original response byte-for-byte, including its HTTP status; the same key with a *different* body is rejected with `409 IDEMPOTENCY_KEY_CONFLICT`, never silently overwritten or merged. Only successful (2xx) responses are cached for replay — a request that failed validation isn't recorded, so retrying it re-validates from scratch.

Scope is `(integrationId, route, idempotencyKey)`: `integrationId` rather than `apiKeyId` so a key rotation doesn't break idempotency continuity for an ongoing integration; `route` is part of the key so the same string reused on two different write routes can never collide with itself.

**Known, stated limitation**: this is a check-then-act design with a unique-constraint fallback for the insert race (`recordIdempotentResponse` catches Postgres error `23505` and re-reads the winning row rather than throwing) — reliable for the realistic case (a caller's HTTP client times out and retries the same request sequentially), but two genuinely *simultaneous* requests with the same key can both pass the initial check and both create a resource before the unique constraint is hit by whichever one loses the race. A fully race-proof guarantee would need a two-phase "reserve, then create" design, not built at this stage — noted here rather than silently overclaimed.

## Rate limiting (per API key) and daily quota (per organization, plan-driven)

Two independent, fixed-window, DB-backed counters (`lib/api-v1/rate-limit.ts`'s `checkRateLimit`, same technique as `lib/gbp-audit/rate-limit.ts` but against the main schema's own `integration_api_rate_limit_hits` table, never the separate Audit Supabase project) are checked on **every** `/api/v1` request, inside `authenticateApiRequest()` — after every other gate (key validity, integration status, scope) has already passed, so a request that would have failed for an unrelated reason never consumes budget:

- **Per-minute, per API key** (`scope="api:minute"`, identifier = the key's own id): a flat anti-abuse budget, independent of subscription plan, protecting against one misbehaving or scraping key. Each key gets its own full allowance — keys never share this counter, even within the same organization.
- **Per-day, per organization** (`scope="api:day"`, identifier = `organizationId`): the dimension a subscription plan actually governs. Aggregated across **every** API key belonging to the organization — this is deliberately a shared budget, not a per-key one, matching "quotas selon les abonnements" being an organization-level concept.

Both checks are **always** computed together, never short-circuited — even if the per-minute check already failed, the per-day check still runs, so the response headers (and the choice between `RATE_LIMITED` and `QUOTA_EXCEEDED`) always reflect the true state of both budgets.

**Limits come from the organization's real subscription** (`lib/api-v1/billing-plan.ts`'s `resolveApiLimitsForOrg`, reading `db/schema.ts`'s `subscriptions` table — one row per organization at most, via a unique index, and an organization can have zero rows):

| Subscription state | Limits used |
|---|---|
| No subscription row at all | Free tier (`lib/billing/api-limits.ts`'s `FREE_API_LIMITS`) |
| `status = "past_due"` or `"canceled"` | Free tier |
| `status = "active"` or `"trialing"` | The plan's real limits (`PLAN_API_LIMITS[plan]`) |
| `status = "active"`/`"trialing"` but an unrecognized `plan` value | Free tier (fails safe, never throws) |

This Free-tier-by-default rule was an explicit user decision: an organization that never subscribed, or whose subscription lapsed, still gets a limited but working API — consistent with the fact that `subscriptions.status` has never gated feature access anywhere else in this app, only ever affected display.

On exceeding either budget, the request is rejected with `429` — `RATE_LIMITED` if the per-minute budget was exceeded, `QUOTA_EXCEEDED` if the per-day quota was (per-minute takes priority when both are simultaneously exceeded) — and the rejection carries a `Retry-After` header (seconds until that specific window resets), logged via the same `logAuthFailure()` path as every other rejection (key prefix only, never the secret).

**Every** `/api/v1` response, success or 429, carries usage headers so a caller always knows where it stands without a separate call: `X-RateLimit-Limit`/`-Remaining`/`-Reset` (the per-minute budget) and `X-Quota-Limit`/`-Remaining`/`-Reset` (the daily quota) — `lib/api-v1/rate-limit.ts`'s `buildUsageHeaders`, attached in `lib/api-v1/auth.ts` on the 429 path and individually in each route file on the success path.

**Deliberately left untouched**: `integrations.dailyEventQuota`/`quotaEnforcedAt` (dormant in the schema since an earlier stage, no admin UI was ever built for them). Verified by direct code reading that they concern the volume of **outbound webhook events** — a different metric from **inbound** `/api/v1` request volume — so this étape builds fresh infrastructure for API requests rather than repurposing a field designed for something else.

**Known, stated limitation**: this is the same fixed-window design as the Audit module's limiter, not a sliding-window or token-bucket shaper — good enough to blunt abuse and cap volume, but a client sending its entire per-minute budget at the very end of one window and the very start of the next can briefly exceed the nominal rate. Acceptable for this stage's goal (protect PUBLIC-MAP, prepare monetization), not a precision traffic-shaping guarantee.

## Explicitly deferred to later étapes (not missing by oversight)

- **Lazily flipping a key's `status` to `"expired"` in the database** once its `expiresAt` passes — today expiry is checked live on every request, which is correct and sufficient; a background sweep is a possible future optimization, not a security gap (the live check makes expiry enforcement immediate either way, it just leaves the stored `status` column temporarily stale for keys nobody has tried to use since expiring).
