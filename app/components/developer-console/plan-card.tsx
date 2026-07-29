import Link from "next/link";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { OrgPlanSummary } from "@/lib/developer-console/queries";

export function PlanCard({ summary, locale = "fr" }: { summary: OrgPlanSummary; locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.dashboard.planCard;
  const planLabel = summary.plan ? (t.planValues[summary.plan] ?? summary.plan) : t.planValues.free;
  const statusLabel = summary.status ? (t.statusValues[summary.status] ?? summary.status) : t.statusValues.none;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-pm-gris">{t.plan}</dt>
          <dd className="text-pm-noir">{planLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-pm-gris">{t.status}</dt>
          <dd className="text-pm-noir">{statusLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-pm-gris">{t.perMinute}</dt>
          <dd className="font-mono text-pm-noir">{summary.limits.requestsPerMinute}</dd>
        </div>
        <div>
          <dt className="text-xs text-pm-gris">{t.perDay}</dt>
          <dd className="font-mono text-pm-noir">{summary.limits.requestsPerDay}</dd>
        </div>
      </dl>
      <Link href="/developers/docs/rate-limits" className="text-xs font-semibold text-pm-noir hover:underline">
        {t.learnMore}
      </Link>
    </section>
  );
}
