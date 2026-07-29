import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader } from "@/components/developer-portal/docs-blocks";

/**
 * Public changelog (Stage 6) — entries are grouped by delivery milestone
 * (the real Stage sequence of this program), not fabricated per-entry
 * dates: precise timestamps for Stages 1-5 aren't tracked, and inventing
 * them would be less honest than being explicit about that gap (see
 * t.note). Content is hand-maintained here, matching every other
 * dictionary-driven /developers/docs/** page — no MDX/markdown pipeline
 * exists in this repo to "reuse" (the architecture plan's Group A never
 * actually introduced one), so none is added just for this page.
 */
export default async function ChangelogPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.changelog;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />
      <p className="text-xs text-pm-gris">{t.note}</p>

      <ol className="flex flex-col gap-4">
        {t.entries.map((entry, index) => (
          <li key={entry.label} className="flex flex-col gap-2 rounded-2xl border border-pm-gris-2 bg-white p-6">
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-pm-gris-2/40 px-2.5 py-0.5 text-xs font-semibold text-pm-noir">
                {t.entries.length - index}
              </span>
              <h2 className="font-serif text-lg font-semibold text-pm-noir">{entry.label}</h2>
            </div>
            <ul className="flex flex-col gap-1.5 pl-1 text-sm text-pm-gris">
              {entry.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="text-pm-g-green">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
