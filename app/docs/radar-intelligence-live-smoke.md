# RADAR Intelligence — Anthropic live smoke (LOCAL DEVELOPMENT ONLY)

A one-time connectivity check that the reviewed Anthropic connection
foundation (Slices 1–3) can reach the provider. It is **not** a
Production step, **not** a data experiment, and **not** something to
automate or repeat.

- Harness: [`scripts/radar-intelligence-live-smoke.mjs`](../scripts/radar-intelligence-live-smoke.mjs)
- Offline tests: [`scripts/radar-intelligence-live-smoke.test.mjs`](../scripts/radar-intelligence-live-smoke.test.mjs) (wired into `npm test`; the live script is never run by CI)

---

## What it does

1. Refuses to run unless **all** of these hold:
   - it is invoked with the flag `--i-understand-this-is-a-live-call`
   - `RADAR_INTELLIGENCE_ANTHROPIC_ENABLED` is exactly `true` (or `1`)
   - `RADAR_INTELLIGENCE_ANTHROPIC_API_KEY` is set to a non-empty value
2. Builds **one** hardcoded synthetic prospect (`"RADAR LIVE SMOKE"`,
   sector `Digital services`, `Mauritius`, stage `prospect`, one benign
   interaction note). No database read, no customer, no PII.
3. Sends **exactly one** provider request (gateway `maxRetries = 0`,
   `max_tokens ≤ 256`, `summarize` only). No loop, no script-level retry.
4. Prints **only** a small allowlist of safe fields, after a redaction
   assertion. Never prints the key, headers, the request/response bodies,
   the prompt, the evidence block, environment variables, or a stack
   trace.

---

## Key handling — read before you touch a key

- Use a **dedicated development / test Anthropic key**. Never a
  Production key.
- Never paste the key into chat, a commit, a log, a screenshot, a ticket,
  or a shell command line.
- Store it **only** in `app/.env.local`, which is gitignored by the
  `.env*` rule in [`.gitignore`](../.gitignore) (`.env.example` /
  `.env.e2e.local.example` are the only allow-listed exceptions).
- The provider stays disabled until you explicitly set the enable flag.
- This runbook covers **local development only**. There is **no**
  Production or Preview configuration here.

### Confirm the ignore rule first (do this before writing a key)

```
cd app
git check-ignore .env.local
```

- If it prints `.env.local` → it is ignored, you may proceed.
- If it prints **nothing** → **STOP**. Do not put a key in any file until
  the ignore behaviour is fixed. (Do not print the key while checking.)

---

## Local setup

Create or edit `app/.env.local` (never committed) with:

```
RADAR_INTELLIGENCE_ANTHROPIC_ENABLED=true
RADAR_INTELLIGENCE_ANTHROPIC_API_KEY=<your-local-dev-key>
# optional; defaults to the reviewed constant if unset
RADAR_INTELLIGENCE_ANTHROPIC_MODEL=claude-sonnet-4-5
```

The harness never creates or edits `.env` / `.env.local` /
`.env.production` / `.env.preview` — you set this by hand.

---

## Run it — exactly once

The harness transitively imports `server-only` modules, so it must run
with the `react-server` condition. Load `.env.local` first.

```
cd app
set -a && source .env.local && set +a
npm run radar:intelligence:live-smoke -- --i-understand-this-is-a-live-call
```

(`npm run radar:intelligence:live-smoke` expands to
`NODE_OPTIONS='--conditions=react-server' tsx scripts/radar-intelligence-live-smoke.mjs`.)

**Do not put the key on the command line.** It is read only from the
environment.

### Expected output — success

Pretty-printed JSON with only these fields:

```
provider, providerAvailable, source, advisoryStatus, summary,
suggestedNextAction, usageTotalTokens, providerUnavailable,
deterministic { priority, confidence, recommendedNextAction },
deterministicFallbackPresent
```

Exit code `0`.

### Expected output — provider failure

Same shape, `advisoryStatus: "NONE"`, `providerUnavailable: true`, plus a
safe normalized `errorCode` / `errorMessage` (one of the fixed
`SAFE_ERROR_MESSAGES`). Exit code `1`. The deterministic block is still
present — RADAR is unaffected.

### Refusal exit codes

| code | meaning |
|---|---|
| 2 | missing `--i-understand-this-is-a-live-call` |
| 3 | `RADAR_INTELLIGENCE_ANTHROPIC_ENABLED` not `true` |
| 4 | no `RADAR_INTELLIGENCE_ANTHROPIC_API_KEY` |
| 5 | redaction assertion tripped — nothing printed |

Refusal paths make **zero** provider calls.

---

## After a successful smoke — STOP

- Do **not** rerun the smoke repeatedly.
- Capture only: the safe provider status, the safe advisory JSON, the
  usage token count, and the success/failure exit code.
- Never capture: the key, request headers, the raw response, or the
  prompt.
- Unset the local env when you are done:
  `unset RADAR_INTELLIGENCE_ANTHROPIC_ENABLED RADAR_INTELLIGENCE_ANTHROPIC_API_KEY`
  and remove the values from `app/.env.local`.

## A successful dev smoke does NOT authorize

- Production secret installation
- Production provider enablement
- automatic RADAR intelligence calls (on page open, per prospect, or in
  the background)
- any "AI" button / badge / settings UI
- persisting AI results
- background generation

Each of those is a **separate**, explicitly reviewed step.
