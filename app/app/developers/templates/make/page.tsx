import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Callout } from "@/components/developer-portal/docs-blocks";

type ScenarioFile = { file: string; name: string };

/** Reads the real generated files off disk — same principle as the n8n
 * templates page and the Bruno collection page's listBrunoFiles(): the
 * page can never drift from what scripts/generate-make-scenarios.mjs
 * actually produced. */
function listMakeScenarios(): ScenarioFile[] {
  const dir = join(process.cwd(), "templates", "make");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((file) => {
      const scenario = JSON.parse(readFileSync(join(dir, file), "utf8"));
      return { file, name: scenario.name as string };
    });
}

export default async function MakeScenariosPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.makeScenariosPage;
  const scenarios = listMakeScenarios();

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
          {scenarios.map(({ file, name }) => (
            <a
              key={file}
              href={`/developers/templates/make/${encodeURIComponent(file)}`}
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
