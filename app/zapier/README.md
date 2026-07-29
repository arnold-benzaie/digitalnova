# PUBLIC-MAP for Zapier

A real [Zapier Platform](https://platform.zapier.com/) integration scaffold for the PUBLIC-MAP public REST API (`/api/v1`) — 3 polling triggers, 3 searches, 3 creates, covering every operation the API supports today. Prepared for a future submission to the Zapier Developer Platform (see "What's left in the official Zapier platform" below for exactly what that still requires).

**Self-contained package** — its own `package.json`, its own dependency (`zapier-platform-core`), its own tests, same pattern as [`sdks/typescript`](../sdks/typescript) and [`sdks/python`](../sdks/python) from Stage 2. Nothing here is part of the main app's dependency tree.

**Generated, not hand-maintained** (except `authentication.js` and `index.js`, which are hand-written scaffolding) — the same source of truth and the same shared parsing module as the n8n templates, Make scenarios, and Airtable scripts: [`lib/api-v1/openapi.yaml`](../lib/api-v1/openapi.yaml) via [`scripts/lib/openapi-operations.mjs`](../scripts/lib/openapi-operations.mjs). Regenerate after any spec change:

```bash
npx tsx scripts/generate-zapier-app.mjs
```

Never hand-edit any file under `triggers/`, `searches/`, or `creates/` — those edits are lost on the next regeneration.

## Triggers: what's available today, and what's explicitly not

**Available — 3 polling triggers**, built entirely on `/api/v1`'s existing read routes:

| Trigger | Polls | Real trigger? |
|---|---|---|
| New Audit | `GET /audits` | Yes — genuinely fires in a real Zap |
| New Client | `GET /clients` | Yes |
| New Report | `GET /reports` | Yes |

These are Zapier's own official, first-class trigger mechanism for APIs without webhooks — **not a workaround**. They need zero changes to PUBLIC-MAP's event catalog: the real list routes already sort newest-first server-side, and Zapier's platform deduplicates polled items by `id` automatically, so no cursor or date-tracking logic was needed here.

**Explicitly impossible at this stage — instant (webhook/REST Hook) triggers.** Zapier's "instant trigger" mechanism requires PUBLIC-MAP to call back into Zapier the moment something happens — which requires a customer-facing event in `lib/integrations/governance.ts`'s `INTEGRATION_EVENT_CATALOG`. That catalog still holds exactly one event, `user.pending.created`, which is strictly internal to PUBLIC-MAP staff (see the design note at [`/developers/docs/event-catalog`](../app/developers/docs/event-catalog/page.tsx)). **No workaround is implemented for this** — per instruction, the limitation is documented here, not papered over with a fake or partial instant trigger.

## Searches and creates

| Type | Key | Real operation |
|---|---|---|
| Search | `find_audit` | `GET /audits/{id}` |
| Search | `find_client` | `GET /clients/{id}` |
| Search | `find_report` | `GET /reports/{id}` |
| Create | `create_task` | `POST /tasks` |
| Create | `create_interaction` | `POST /interactions` |
| Create | `update_client` | `PATCH /clients/{id}` |

`create_task` and `create_interaction` (the two `POST` routes) send a real `Idempotency-Key` header, derived by hashing the input data (`z.hash('sha256', JSON.stringify(bundle.inputData))`) — identical input always produces the identical key, so a Zapier-side retry of the same create is safely deduped by the real API (see the [Idempotency guide](../app/developers/docs/idempotency/page.tsx)) instead of creating a duplicate.

## No API key is ever embedded

Authentication is a single `apiKey` field (`authentication.js`, `type: 'custom'`) verified against the real `GET /ping` route. Zapier stores the key encrypted per end-user connection; this codebase never logs it, never writes it to a sample, and never embeds one — every request gets it via the `addApiKeyToHeader` `beforeRequest` hook, added once in `index.js`, not repeated in every trigger/search/create.

## Real validation already run

This app was validated with Zapier's own official CLI (`zapier-platform-cli`, installed temporarily, then removed — see below):

```
Validating project locally
No structural errors found during validation routine.
This project is structurally sound!
- 25 checks passed, 0 failed, 0 publishing warnings, 16 general (non-blocking) warnings
```

The 16 remaining warnings are optional UX polish, not correctness issues:
- `D028` (×6): consider `cleanInputData: false` per action — a predictability tweak, not a defect.
- `D004` (×6): ID fields (`clientId`, `auditId`, `reportId`) "look like" they'd benefit from a dynamic dropdown (letting a user pick from a live list instead of typing a raw UUID) — a real, legitimate future enhancement, deliberately not built now (it needs its own `search`-powered dropdown wiring, a bigger feature than this stage's "implement only what's really compatible with the current API" scope).
- `D002` (×1): the `apiKey` auth field could link to more info — minor copy polish.

**Why `zapier-platform-cli` isn't a dependency of this package**: installing it pulled in ~780 transitive packages and 48 vulnerabilities (1 critical, 42 high) — almost entirely from its own dev-tooling chain (old `glob`/`tar` versions), nothing to do with this app's own code. It was installed once, used to capture the validation output above, then removed. Anyone continuing this work should install it globally instead: `npm install -g zapier-platform-cli`, per [Zapier's own setup docs](https://docs.zapier.com/platform/quickstart) — that's how Zapier expects it to be used anyway (the CLI is also how you eventually `zapier login` / `zapier push`, neither of which belongs inside a project's own dependency tree).

The one dependency this package does keep, `zapier-platform-core`, still carries a known high-severity transitive advisory (`form-data`, CRLF injection via unescaped multipart fields) — present in every currently published major version of `zapier-platform-core`, not something a version bump can currently fix, and not a code path this app exercises (no multipart/form-data requests are made anywhere here, only JSON). Documented, not hidden.

## Tests

```bash
cd zapier && npm install && npm test
```

No live PUBLIC-MAP server exists yet to test against (`lib/api-v1/openapi.yaml`'s own `servers` entry says so explicitly), so tests exercise the real generated `perform` functions against a stubbed `z.request` — real code, fake network — verifying the exact URL/method/body/headers each one constructs, not just their exported shape.

## Differences from n8n, Make, and Airtable

| | n8n | Make | Airtable | Zapier |
|---|---|---|---|---|
| Delivered as | Workflow JSON | Blueprint JSON | JavaScript source (paste in) | **A real requireable Node package** |
| "Action" concept | One HTTP node | One HTTP module | One script | **Split into `creates` (write) and `searches` (read-one)** |
| List/"new item" concept | N/A (action-only) | N/A (action-only) | N/A (action-only) | **A first-class `triggers` resource type — polling, not instant** |
| Auth | `$env.*` | Manual placeholder | `input.config()` | **A declared `authentication` schema Zapier's UI renders as a real connection form** |
| Real vendor validation possible here | No (no local n8n) | No (no local Make) | No (no local Airtable) | **Yes — `zapier-platform validate`, run and passing** |

Zapier's platform is the only one of the four with an actual local schema validator (`zapier-platform-cli`) usable without a live account — which is why this sub-stage carries real, tool-verified confidence the others could only approximate with hand-written structural tests.

## What's left in the official Zapier platform (cannot be done from this repository)

- **Registering the app** (`zapier register`) — creates the app in Zapier's system, requires a real Zapier developer account.
- **`zapier push`** — uploads this code as a real, installable (private) version of the integration; requires the account above and the CLI logged in.
- **Developer configuration in the Zapier dashboard**: app icon/branding, category, public description, OAuth/API-key field help links beyond what's already declared here, and the `D004` dynamic-dropdown enhancements if pursued.
- **Human review and publication** to the public Zapier App Directory — a real submission/review process on Zapier's side (per the architecture plan's own note that this mirrors the "Zapier exige une vraie soumission/review d'app" constraint), with its own timeline outside this project's control.
- **A real end-to-end test against a live `app.public-map.com`** — not possible today since the production API isn't deployed yet.

None of the above is code that could be written here — they are actions on Zapier's own platform, requiring a real account, exactly like a packaged Airtable Extension requires Airtable's own Marketplace pipeline.
