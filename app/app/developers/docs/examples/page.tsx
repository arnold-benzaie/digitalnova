import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader } from "@/components/developer-portal/docs-blocks";
import { ExamplesClient, type ExampleScenario } from "@/components/developer-portal/examples-client";

const SCENARIOS: Omit<ExampleScenario, "title">[] = [
  {
    key: "ping",
    snippets: {
      curl: `curl https://app.public-map.com/api/v1/ping \\
  -H "Authorization: Bearer $PUBLIC_MAP_API_KEY"`,
      javascript: `const { PublicMapClient } = require("@public-map/sdk");

const client = new PublicMapClient({ apiKey: process.env.PUBLIC_MAP_API_KEY });
const { organizationId, scopes } = await client.ping();
console.log(organizationId, scopes);`,
      typescript: `import { PublicMapClient } from "@public-map/sdk";

const client = new PublicMapClient({ apiKey: process.env.PUBLIC_MAP_API_KEY! });
const { organizationId, scopes } = await client.ping();
console.log(organizationId, scopes);`,
      python: `import os
from public_map_sdk import PublicMapClient

client = PublicMapClient(api_key=os.environ["PUBLIC_MAP_API_KEY"])
result = client.ping()
print(result["organizationId"], result["scopes"])`,
    },
  },
  {
    key: "listAudits",
    snippets: {
      curl: `curl "https://app.public-map.com/api/v1/audits?limit=20" \\
  -H "Authorization: Bearer $PUBLIC_MAP_API_KEY"

# Next page — pass the previous response's pagination.nextCursor:
curl "https://app.public-map.com/api/v1/audits?limit=20&cursor=$CURSOR" \\
  -H "Authorization: Bearer $PUBLIC_MAP_API_KEY"`,
      javascript: `const { paginate } = require("@public-map/sdk");

for await (const audit of paginate((cursor) => client.audits.list({ cursor, limit: 20 }))) {
  console.log(audit.id, audit.score);
}`,
      typescript: `import { paginate } from "@public-map/sdk";

for await (const audit of paginate((cursor) => client.audits.list({ cursor, limit: 20 }))) {
  console.log(audit.id, audit.score);
}`,
      python: `from public_map_sdk import paginate

for audit in paginate(lambda cursor: client.audits.list(cursor=cursor, limit=20)):
    print(audit.id, audit.score)`,
    },
  },
  {
    key: "createTask",
    snippets: {
      curl: `curl -X POST https://app.public-map.com/api/v1/tasks \\
  -H "Authorization: Bearer $PUBLIC_MAP_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: task-followup-2026-01" \\
  -d '{"clientId": "'"$CLIENT_ID"'", "title": "Follow up"}'`,
      javascript: `const task = await client.tasks.create(
  { clientId, title: "Follow up" },
  { idempotencyKey: "task-followup-2026-01" },
);`,
      typescript: `const task = await client.tasks.create(
  { clientId, title: "Follow up" },
  { idempotencyKey: "task-followup-2026-01" },
);`,
      python: `task = client.tasks.create(
    client_id=client_id,
    title="Follow up",
    idempotency_key="task-followup-2026-01",
)`,
    },
  },
  {
    key: "handleError",
    snippets: {
      curl: `# A 429 response looks like this:
# HTTP/1.1 429 Too Many Requests
# Retry-After: 42
# {"error":{"code":"RATE_LIMITED","message":"...","requestId":"..."}}
#
# Read the Retry-After header and wait before retrying.`,
      javascript: `const { PublicMapApiError } = require("@public-map/sdk");

try {
  await client.audits.list();
} catch (err) {
  if (err instanceof PublicMapApiError && err.code === "RATE_LIMITED") {
    await new Promise((r) => setTimeout(r, (err.retryAfterSeconds ?? 1) * 1000));
    // retry
  }
}`,
      typescript: `import { PublicMapApiError } from "@public-map/sdk";

try {
  await client.audits.list();
} catch (err) {
  if (err instanceof PublicMapApiError && err.code === "RATE_LIMITED") {
    await new Promise((r) => setTimeout(r, (err.retryAfterSeconds ?? 1) * 1000));
    // retry
  }
}`,
      python: `import time
from public_map_sdk import PublicMapApiError

try:
    client.audits.list()
except PublicMapApiError as err:
    if err.code == "RATE_LIMITED":
        time.sleep(err.retry_after_seconds or 1)
        # retry`,
    },
  },
];

export default async function ExamplesPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.examples;

  const scenarios: ExampleScenario[] = SCENARIOS.map((scenario) => ({
    ...scenario,
    title: t.scenarios[scenario.key as keyof typeof t.scenarios].title,
  }));

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />
      <ExamplesClient tabLabels={t.tabs} scenarios={scenarios} />
    </div>
  );
}
