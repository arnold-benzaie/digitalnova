# n8n action templates

10 n8n workflow templates for the PUBLIC-MAP public REST API (`/api/v1`) — one per real operation. Each is an **action** template: a Manual Trigger node (you click "Execute Workflow" to run it) followed by one HTTP Request node calling PUBLIC-MAP.

**No trigger (webhook) templates here.** PUBLIC-MAP's outbound event catalog is still a single internal-only event (`user.pending.created` — see [`lib/integrations/governance.ts`](../../lib/integrations/governance.ts) and the design note at [`/developers/docs/event-catalog`](../../app/developers/docs/event-catalog/page.tsx)); there is no customer-facing event yet for a real n8n workflow to react to. These templates only cover the "do something in PUBLIC-MAP" half of an automation, not the "when something happens in PUBLIC-MAP" half.

**Generated, not hand-maintained** — the single source of truth is [`lib/api-v1/openapi.yaml`](../../lib/api-v1/openapi.yaml), via the same parsing module the Postman/Bruno/Insomnia collections use ([`scripts/lib/openapi-operations.mjs`](../../scripts/lib/openapi-operations.mjs)). Regenerate after any spec change:

```bash
npx tsx scripts/generate-n8n-templates.mjs
```

Never hand-edit any file in this directory — those edits are lost on the next regeneration.

## Import

1. In n8n, go to **Workflows → Import from File** and select one of the `.json` files below.
2. Before running it, set two environment variables on your n8n instance:
   - `PUBLIC_MAP_BASE_URL` — the full versioned API base, e.g. `https://app.public-map.com/api/v1` (no trailing slash).
   - `PUBLIC_MAP_API_KEY` — a real PUBLIC-MAP API key, created from the [Developer Console](https://app.public-map.com/developers/console). No key is ever embedded in these files.
3. For any template whose URL contains a placeholder like `YOUR_ID` or `YOUR_CLIENTID`, open the HTTP Request node and replace it with a real value before running.
4. For the two write operations (`createTask`, `createInteraction`), open the node's JSON body and fill in the real values — the generated body only has the fields the API actually requires.

## Templates

| File | Operation |
|---|---|
| `ping.json` | Verify an API key is valid and see which scopes it carries |
| `listAudits.json` | List audits |
| `getAudit.json` | Get a single audit |
| `listReports.json` | List reports |
| `getReport.json` | Get a single report |
| `listClients.json` | List clients |
| `getClient.json` | Get a single client |
| `updateClient.json` | Update a client (whitelisted fields only) |
| `createTask.json` | Create a staff to-do tied to a client |
| `createInteraction.json` | Log a client interaction |

## Why environment variables, not an n8n Credential

A plain workflow JSON export can reference a saved n8n Credential by id, but that id would never resolve on a different n8n instance — importing the workflow wouldn't bring the credential with it, and there is nothing PUBLIC-MAP can safely pre-fill anyway (see the reveal-once API key model in the Developer Console). Reading `$env.PUBLIC_MAP_API_KEY` at execution time keeps the template fully self-contained and portable, and never puts a real key inside a file that gets shared, downloaded, or diffed.
