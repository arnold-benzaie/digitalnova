import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { CodeBlock, DocsPageHeader, Section } from "@/components/developer-portal/docs-blocks";

const TS_INIT = `import { PublicMapClient } from "@public-map/sdk";

const client = new PublicMapClient({ apiKey: process.env.PUBLIC_MAP_API_KEY! });`;

const PY_INIT = `import os
from public_map_sdk import PublicMapClient

client = PublicMapClient(api_key=os.environ["PUBLIC_MAP_API_KEY"])`;

const TS_ERRORS = `import { PublicMapApiError } from "@public-map/sdk";

try {
  await client.clients.get(id);
} catch (err) {
  if (err instanceof PublicMapApiError) {
    console.error(err.code, err.status, err.requestId);
  }
}`;

const PY_ERRORS = `from public_map_sdk import PublicMapApiError

try:
    client.clients.get(client_id)
except PublicMapApiError as err:
    print(err.code, err.status, err.request_id)`;

const TS_PAGINATE = `import { paginate } from "@public-map/sdk";

for await (const audit of paginate((cursor) => client.audits.list({ cursor }))) {
  console.log(audit.id);
}`;

const PY_PAGINATE = `from public_map_sdk import paginate

for audit in paginate(lambda cursor: client.audits.list(cursor=cursor)):
    print(audit.id)`;

export default async function SdkUsagePage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.sdkUsage;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <Section title={t.sections.intro.title}>
        <p className="text-muted-foreground">{t.sections.intro.body}</p>
      </Section>

      <Section title={t.sections.sourceOfTruth.title}>
        <p className="text-muted-foreground">{t.sections.sourceOfTruth.body}</p>
      </Section>

      <Section title={t.sections.install.title}>
        <p className="text-muted-foreground">{t.sections.install.body}</p>
        <CodeBlock>{"npm install @public-map/sdk"}</CodeBlock>
        <CodeBlock>{"pip install public-map-sdk"}</CodeBlock>
      </Section>

      <Section title={t.sections.initialize.title}>
        <CodeBlock>{TS_INIT}</CodeBlock>
        <CodeBlock>{PY_INIT}</CodeBlock>
      </Section>

      <Section title={t.sections.errorHandling.title}>
        <p className="text-muted-foreground">{t.sections.errorHandling.body}</p>
        <CodeBlock>{TS_ERRORS}</CodeBlock>
        <CodeBlock>{PY_ERRORS}</CodeBlock>
      </Section>

      <Section title={t.sections.pagination.title}>
        <p className="text-muted-foreground">{t.sections.pagination.body}</p>
        <CodeBlock>{TS_PAGINATE}</CodeBlock>
        <CodeBlock>{PY_PAGINATE}</CodeBlock>
      </Section>
    </div>
  );
}
