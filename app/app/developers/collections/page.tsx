import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

function listBrunoFiles(): string[] {
  const dir = join(process.cwd(), "collections", "bruno");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".bru") || name === "bruno.json")
    .sort();
}

export default async function CollectionsPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.collectionsPage;
  const brunoFiles = listBrunoFiles();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-base text-muted-foreground">{t.subtitle}</p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.items.postman.title}</h2>
        <p className="text-sm text-muted-foreground">{t.items.postman.description}</p>
        <a
          href="/developers/collections/postman"
          className="w-fit rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          {t.items.postman.download}
        </a>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.items.bruno.title}</h2>
        <p className="text-sm text-muted-foreground">{t.items.bruno.description}</p>
        <div className="flex flex-wrap gap-2">
          {brunoFiles.map((file) => (
            <a
              key={file}
              href={`/developers/collections/bruno/${encodeURIComponent(file)}`}
              className="rounded-full border border-border px-4 py-1.5 text-xs font-mono text-foreground transition hover:border-primary"
            >
              {file} ↓
            </a>
          ))}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- this is a Route Handler file download, not a Next.js page; a plain <a> triggers a real browser download, which next/link's client-side navigation would not. */}
          <a
            href="/developers/collections/bruno/environment"
            className="rounded-full border border-border px-4 py-1.5 text-xs font-mono text-foreground transition hover:border-primary"
          >
            environments/production.bru ↓
          </a>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.items.insomnia.title}</h2>
        <p className="text-sm text-muted-foreground">{t.items.insomnia.description}</p>
        <a
          href="/developers/collections/insomnia"
          className="w-fit rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          {t.items.insomnia.download}
        </a>
      </section>

      <p className="text-sm text-muted-foreground">{t.setVariable}</p>
      <p className="text-xs text-muted-foreground">{t.alternativeNote}</p>
    </div>
  );
}
