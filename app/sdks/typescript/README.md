# @public-map/sdk

Official TypeScript/JavaScript SDK for the [PUBLIC-MAP](https://app.public-map.com) public REST API (`/api/v1`). One package serves both audiences: full generated types for TypeScript, plain compiled JavaScript (with `.d.ts` files alongside, so editors still autocomplete) for JavaScript.

> Status: pre-release (`0.1.0`), built alongside the [developer portal](/developers). Not yet published to npm — see `/developers/sdk` once Stage 2 ships for install instructions once it is.

## Install (once published)

```bash
npm install @public-map/sdk
```

## Usage

```ts
import { PublicMapClient } from "@public-map/sdk";

const client = new PublicMapClient({ apiKey: process.env.PUBLIC_MAP_API_KEY! });

const { data: audits } = await client.audits.list({ limit: 20 });
const client1 = await client.clients.get(audits[0].location?.id ?? "");
await client.clients.update(client1.id, { name: "New name" });

await client.tasks.create({ clientId: client1.id, title: "Follow up" }, { idempotencyKey: "task-followup-2026-01" });
```

Plain JavaScript works identically (no build step, no types required):

```js
const { PublicMapClient } = require("@public-map/sdk"); // or: import ... from "@public-map/sdk"
const client = new PublicMapClient({ apiKey: process.env.PUBLIC_MAP_API_KEY });
const { data } = await client.audits.list();
```

## Pagination

```ts
import { paginate } from "@public-map/sdk";

for await (const audit of paginate((cursor) => client.audits.list({ cursor }))) {
  console.log(audit.id);
}
```

## Error handling

```ts
import { PublicMapApiError } from "@public-map/sdk";

try {
  await client.clients.get("unknown-id");
} catch (err) {
  if (err instanceof PublicMapApiError) {
    console.error(err.code, err.status, err.requestId);
    if (err.code === "RATE_LIMITED" || err.code === "QUOTA_EXCEEDED") {
      // err.retryAfterSeconds is set
    }
  }
}
```

## Development

This package's types are **generated** from `lib/api-v1/openapi.yaml` (the same spec `/developers/reference` renders) — never hand-edit `src/generated/schema.ts`.

```bash
npm install
npm run generate   # regenerate src/generated/schema.ts from the OpenAPI spec
npm run typecheck
npm test           # node:test, mocks fetch — no live server needed
npm run build      # emits dist/ (JS + .d.ts)
```

See `/developers/docs/authentication`, `/developers/docs/pagination`, `/developers/docs/rate-limits`, and `/developers/docs/sdk-usage` for the concepts this SDK wraps.
