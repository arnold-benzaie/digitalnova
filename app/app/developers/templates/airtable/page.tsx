import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Callout, CodeBlock } from "@/components/developer-portal/docs-blocks";

type ScriptFile = { file: string; name: string; source: string };

/** Reads the real generated files off disk — same principle as the n8n/
 * Make template pages: the page can never drift from what
 * scripts/generate-airtable-scripts.mjs actually produced. Airtable has
 * no import mechanism, so — unlike those two pages — this one shows the
 * full source inline (via <details>) so a developer can copy it directly
 * without a separate download step, in addition to the download link. */
function listAirtableScripts(): ScriptFile[] {
  const dir = join(process.cwd(), "templates", "airtable");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((file) => {
      const source = readFileSync(join(dir, file), "utf8");
      const name = source.split("\n")[0].replace(/^\/\/\s*PUBLIC-MAP\s*—\s*/, "");
      return { file, name, source };
    });
}

export default async function AirtableScriptsPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.airtableScriptsPage;
  const scripts = listAirtableScripts();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-base text-muted-foreground">{t.subtitle}</p>
      </div>

      <Callout tone="warning">{t.noImportNotice}</Callout>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.setupTitle}</h2>
        <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
          {t.setupSteps.map((step, i) => (
            <li key={step} className="flex gap-2">
              <span className="font-semibold text-muted-foreground">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        {scripts.map(({ file, name, source }) => (
          <details key={file} className="group rounded-2xl border border-border bg-card p-6">
            <summary className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">{name}</span>
              <a
                href={`/developers/templates/airtable/${encodeURIComponent(file)}`}
                className="shrink-0 font-mono text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {file} ↓
              </a>
            </summary>
            <div className="mt-4">
              <CodeBlock>{source}</CodeBlock>
            </div>
          </details>
        ))}
      </section>

      <p className="text-xs text-muted-foreground">{t.downloadAll}</p>
    </div>
  );
}
