# Airtable automation scripts

10 JavaScript snippets for the PUBLIC-MAP public REST API (`/api/v1`) — one per real operation, same coverage as [`templates/n8n/`](../n8n/) and [`templates/make/`](../make/). Each is written for Airtable's **"Run a script"** Automation action — Airtable's own sandboxed JavaScript step.

**No trigger scripts here.** Same reason as the n8n/Make templates: PUBLIC-MAP's outbound event catalog is still a single internal-only event (`user.pending.created`) — see [`/developers/docs/event-catalog`](../../app/developers/docs/event-catalog/page.tsx). These scripts only cover the "do something in PUBLIC-MAP" half of an automation.

**Generated, not hand-maintained** — same source of truth and the same shared parsing module as the n8n templates, Make scenarios, and the Postman/Bruno/Insomnia collections: [`lib/api-v1/openapi.yaml`](../../lib/api-v1/openapi.yaml) via [`scripts/lib/openapi-operations.mjs`](../../scripts/lib/openapi-operations.mjs). Regenerate after any spec change:

```bash
npx tsx scripts/generate-airtable-scripts.mjs
```

Never hand-edit any file in this directory — those edits are lost on the next regeneration.

## Why Airtable is structurally different from n8n and Make — read this first

Airtable has **no portable "import this file and get a ready-made automation" mechanism at all.** This is not a gap in this generator — it's a real limit of the platform, and it's exactly why the architecture plan calls the Airtable connector "a mini-integration in its own right," not just another template file.

| | n8n | Make | Airtable |
|---|---|---|---|
| **File format** | Workflow JSON | Scenario blueprint JSON | JavaScript source |
| **How you use it** | File → Import from File | Import Blueprint | Open the file, **copy its contents**, paste into the "Run a script" step's code editor |
| **Where secrets/config live** | `$env.PUBLIC_MAP_API_KEY` (OS-level env var, read directly in any field) | A literal placeholder you edit in the module after import | `input.config()` — named input variables you configure in the automation step's UI (Airtable's own real mechanism for this, not invented here) |
| **How "run without a trigger" is satisfied** | A Manual Trigger node | The scenario's only module is an action, run via "Run once" | **Cannot be avoided the same way — see below** |
| **Runtime** | Self-hosted or cloud n8n instance | Make cloud | Airtable's own sandboxed JS runtime, as one step inside a base's Automation |

### The one constraint every Airtable automation forces on you: it always needs *a* trigger

Unlike n8n and Make, an Airtable Automation cannot exist without some trigger configured — there is no "just run this one action" mode independent of any trigger. This does **not** mean these scripts secretly depend on the PUBLIC-MAP event catalog. It means the trigger you pick must come from **Airtable's own side**, never from a PUBLIC-MAP webhook:

- **Recommended for testing**: **"When a button is clicked."** Add a button field to any table; clicking it runs the automation on demand — the direct Airtable equivalent of n8n's Manual Trigger or Make's "Run once."
- **Also fine**: **"At a scheduled time"** (e.g. poll PUBLIC-MAP every hour) or **"When a record is created/updated"** in an *Airtable* table you control (e.g. a "Tasks to sync" table your team fills in) — both are triggered by Airtable-side activity, not a PUBLIC-MAP event.
- **Never**: any trigger that waits for a PUBLIC-MAP webhook — none exists for a customer-facing domain yet (see the event catalog design note).

## Import (really: copy-paste) instructions

1. In your Airtable base, create an **Automation**, add a trigger from the list above (button click is simplest), then add a **"Run a script"** action step.
2. Open one of the `.js` files below, copy its full contents, and paste it into the script step's code editor.
3. In the script step's **input variables**, add:
   - `apiKey` → a real PUBLIC-MAP API key, created from the [Developer Console](https://app.public-map.com/developers/console). **Never paste a real key into the script source itself** — only into this input variable field.
   - `baseUrl` (optional) → override if you're targeting a different environment than `https://app.public-map.com/api/v1`.
   - Any other variable listed in the script's header comment (e.g. `id`, `clientId`) — map it from a previous step's output, or a field on the triggering record.
4. For the two write operations (`createTask`, `createInteraction`): the script body only has the fields the API actually requires — map real values from your table's fields via the input variables, or edit the script directly for a quick test.
5. The script's output (`responseStatus`, `responseBody`) is available to later steps in the automation via `output.set()` — e.g. to write the result back into an Airtable field.

## Scripts

| File | Operation |
|---|---|
| `ping.js` | Verify an API key is valid and see which scopes it carries |
| `listAudits.js` | List audits |
| `getAudit.js` | Get a single audit |
| `listReports.js` | List reports |
| `getReport.js` | Get a single report |
| `listClients.js` | List clients |
| `getClient.js` | Get a single client |
| `updateClient.js` | Update a client (whitelisted fields only) |
| `createTask.js` | Create a staff to-do tied to a client |
| `createInteraction.js` | Log a client interaction |

## What's out of scope here

A real, installable **Airtable Extension** (via Airtable's Blocks SDK, listed in the Airtable Marketplace) would be a materially larger undertaking — its own build/publish pipeline through Airtable's developer tools, outside what a downloadable script file can be. That's a separate, bigger piece of work, not started here, exactly like a real Zapier app submission is out of scope for the Zapier sub-stage.
