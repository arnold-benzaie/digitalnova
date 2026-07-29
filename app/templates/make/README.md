# Make (Integromat) action scenarios

10 Make scenario blueprints for the PUBLIC-MAP public REST API (`/api/v1`) — one per real operation, same coverage as [`templates/n8n/`](../n8n/). Each is a single [`http:ActionSendData`](https://www.make.com/en/help/tools/http) module ("HTTP > Make a request") — Make's own generic outbound HTTP action, run manually ("Run once") after import.

**No trigger scenarios here.** Same reason as the n8n templates: PUBLIC-MAP's outbound event catalog is still a single internal-only event (`user.pending.created`) — see [`/developers/docs/event-catalog`](../../app/developers/docs/event-catalog/page.tsx). These scenarios only cover the "do something in PUBLIC-MAP" half of an automation.

**Generated, not hand-maintained** — same source of truth and the same shared parsing module as the n8n templates and the Postman/Bruno/Insomnia collections: [`lib/api-v1/openapi.yaml`](../../lib/api-v1/openapi.yaml) via [`scripts/lib/openapi-operations.mjs`](../../scripts/lib/openapi-operations.mjs). Regenerate after any spec change:

```bash
npx tsx scripts/generate-make-scenarios.mjs
```

Never hand-edit any file in this directory — those edits are lost on the next regeneration.

## Why these scenarios look structurally different from the n8n ones

Two real, deliberate differences — not oversights:

1. **No separate "trigger" module.** n8n requires an explicit Manual Trigger node before any action node can run. Make has no equivalent requirement: any module, including a plain HTTP action, can be the sole first module of a scenario and still be run manually from the Make editor. Each scenario here is therefore **one module**, not two.
2. **No environment-variable expression.** n8n can read `$env.PUBLIC_MAP_API_KEY` directly in any field. Make's mapper expression language (`{{moduleId.field}}`) has no equivalent primitive without a real upstream module supplying the value — and this generator deliberately doesn't invent one, since a wrong or unverifiable Make module type (e.g. a "Set variable(s)" module) risks breaking the import entirely. Instead, the API key is a clearly-named literal placeholder, `YOUR_PUBLIC_MAP_API_KEY`, that you paste your real key over directly in the HTTP module after import — exactly like the `YOUR_ID`-style path placeholders. **No real key is ever in these files.**

If you want to reuse the same key across several scenarios without re-pasting it into every one, create a Make **Connection** or use a **Data Store** for it — both are safe, real Make mechanisms for that, deliberately left for you to set up rather than guessed at here.

## Import

1. In Make, go to **Scenarios → Create a new scenario → Import Blueprint** and select one of the `.json` files below.
2. Open the HTTP module and replace `YOUR_PUBLIC_MAP_API_KEY` in the `Authorization` header with a real PUBLIC-MAP API key, created from the [Developer Console](https://app.public-map.com/developers/console).
3. For any scenario whose URL contains a placeholder like `YOUR_ID` or `YOUR_CLIENTID`, replace it with a real value.
4. For the two write operations (`createTask`, `createInteraction`): fill in the request body's real values, and replace `REPLACE_WITH_A_UNIQUE_VALUE_PER_RUN` in the `Idempotency-Key` header with an actual unique value before each run (a single static value reused every run would make every run after the first a no-op — see the idempotency guide).
5. The default URL points at `https://app.public-map.com/api/v1` — edit it if you're targeting a different environment.

## Scenarios

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
