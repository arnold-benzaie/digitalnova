import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function IntegrationCard({
  integration,
  locale = "fr",
}: {
  integration: { name: string; status: string; createdAt: string } | null;
  locale?: Locale;
}) {
  const t = dictionaries[locale].developerConsole.dashboard.integrationCard;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>
      {integration ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-pm-gris">{t.name}</dt>
            <dd className="text-pm-noir">{integration.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-pm-gris">{t.status}</dt>
            <dd className="text-pm-noir">{t.statusValues[integration.status] ?? integration.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-pm-gris">{t.createdAt}</dt>
            <dd className="text-pm-noir">{formatDate(integration.createdAt, locale)}</dd>
          </div>
        </dl>
      ) : (
        <div>
          <p className="text-sm font-medium text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-xs text-pm-gris">{t.emptyHint}</p>
        </div>
      )}
    </section>
  );
}
