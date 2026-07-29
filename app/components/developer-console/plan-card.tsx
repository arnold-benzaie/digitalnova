import Link from "next/link";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { OrgPlanSummary } from "@/lib/developer-console/queries";

export function PlanCard({ summary, locale = "fr" }: { summary: OrgPlanSummary; locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.dashboard.planCard;
  const planLabel = summary.plan ? (t.planValues[summary.plan] ?? summary.plan) : t.planValues.free;
  const statusLabel = summary.status ? (t.statusValues[summary.status] ?? summary.status) : t.statusValues.none;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-serif text-lg font-semibold text-foreground">{t.title}</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t.plan}</dt>
          <dd className="text-foreground">{planLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.status}</dt>
          <dd className="text-foreground">{statusLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.perMinute}</dt>
          <dd className="font-mono text-foreground">{summary.limits.requestsPerMinute}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.perDay}</dt>
          <dd className="font-mono text-foreground">{summary.limits.requestsPerDay}</dd>
        </div>
      </dl>
      <Link href="/developers/docs/rate-limits" className="text-xs font-semibold text-foreground hover:underline">
        {t.learnMore}
      </Link>
    </section>
  );
}
