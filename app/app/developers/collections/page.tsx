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
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="text-base text-pm-gris">{t.subtitle}</p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.items.postman.title}</h2>
        <p className="text-sm text-pm-gris">{t.items.postman.description}</p>
        <a
          href="/developers/collections/postman"
          className="w-fit rounded-full bg-pm-noir px-5 py-2.5 text-sm font-semibold text-pm-blanc transition hover:bg-pm-noir-2"
        >
          {t.items.postman.download}
        </a>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.items.bruno.title}</h2>
        <p className="text-sm text-pm-gris">{t.items.bruno.description}</p>
        <div className="flex flex-wrap gap-2">
          {brunoFiles.map((file) => (
            <a
              key={file}
              href={`/developers/collections/bruno/${encodeURIComponent(file)}`}
              className="rounded-full border border-pm-gris-2 px-4 py-1.5 text-xs font-mono text-pm-noir transition hover:border-pm-noir"
            >
              {file} ↓
            </a>
          ))}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- this is a Route Handler file download, not a Next.js page; a plain <a> triggers a real browser download, which next/link's client-side navigation would not. */}
          <a
            href="/developers/collections/bruno/environment"
            className="rounded-full border border-pm-gris-2 px-4 py-1.5 text-xs font-mono text-pm-noir transition hover:border-pm-noir"
          >
            environments/production.bru ↓
          </a>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.items.insomnia.title}</h2>
        <p className="text-sm text-pm-gris">{t.items.insomnia.description}</p>
        <a
          href="/developers/collections/insomnia"
          className="w-fit rounded-full bg-pm-noir px-5 py-2.5 text-sm font-semibold text-pm-blanc transition hover:bg-pm-noir-2"
        >
          {t.items.insomnia.download}
        </a>
      </section>

      <p className="text-sm text-pm-gris">{t.setVariable}</p>
      <p className="text-xs text-pm-gris">{t.alternativeNote}</p>
    </div>
  );
}
