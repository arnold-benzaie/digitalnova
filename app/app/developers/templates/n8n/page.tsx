import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Callout } from "@/components/developer-portal/docs-blocks";

type TemplateFile = { file: string; name: string };

/** Reads the real generated files off disk — the page never hand-lists
 * templates, so it can never drift from what scripts/generate-n8n-
 * templates.mjs actually produced (same principle as the Bruno
 * collection page's listBrunoFiles()). The workflow's own `name` field
 * (already "PUBLIC-MAP — {summary}", straight from the OpenAPI spec) is
 * reused as the display label instead of duplicating a description here. */
function listN8nTemplates(): TemplateFile[] {
  const dir = join(process.cwd(), "templates", "n8n");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((file) => {
      const workflow = JSON.parse(readFileSync(join(dir, file), "utf8"));
      return { file, name: workflow.name as string };
    });
}

export default async function N8nTemplatesPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.n8nTemplatesPage;
  const templates = listN8nTemplates();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-base text-muted-foreground">{t.subtitle}</p>
      </div>

      <Callout tone="warning">{t.noTriggerNotice}</Callout>

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

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-1 rounded-xl border border-border">
          {templates.map(({ file, name }) => (
            <a
              key={file}
              href={`/developers/templates/n8n/${encodeURIComponent(file)}`}
              className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0 transition hover:bg-muted/20"
            >
              <span className="text-sm text-foreground">{name.replace(/^PUBLIC-MAP — /, "")}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{file} ↓</span>
            </a>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t.downloadAll}</p>
      </section>
    </div>
  );
}
