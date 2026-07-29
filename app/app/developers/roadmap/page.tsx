import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function RoadmapPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.roadmap;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="text-base text-pm-gris">{t.subtitle}</p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.shippedTitle}</h2>
        <ul className="flex flex-col gap-2 text-sm text-pm-noir">
          {t.shipped.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="text-pm-g-green">
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.upcomingTitle}</h2>
        <ul className="flex flex-col gap-2 text-sm text-pm-gris">
          {t.upcoming.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="text-pm-or-2">
                ○
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-pm-gris">{t.disclaimer}</p>
    </div>
  );
}
