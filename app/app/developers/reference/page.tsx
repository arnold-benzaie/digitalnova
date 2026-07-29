import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function ReferencePage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.reference;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="text-base text-pm-gris">{t.subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/developers/reference/embed"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-pm-noir px-5 py-2.5 text-sm font-semibold text-pm-blanc transition hover:bg-pm-noir-2"
        >
          {t.openLabel} ↗
        </a>
        <a href="/developers/openapi.yaml" className="rounded-full border border-pm-gris-2 px-5 py-2.5 text-sm font-semibold text-pm-noir transition hover:border-pm-noir">
          {t.specLinkLabel}
        </a>
      </div>

      <p className="text-xs text-pm-gris">{t.note}</p>

      <iframe
        src="/developers/reference/embed"
        title={t.title}
        className="min-h-[80vh] w-full rounded-2xl border border-pm-gris-2"
      />
    </div>
  );
}
