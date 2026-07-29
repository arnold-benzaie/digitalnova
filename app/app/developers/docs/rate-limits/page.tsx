import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader, DocsTable, Section } from "@/components/developer-portal/docs-blocks";

export default async function RateLimitsPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.rateLimits;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <Section title={t.sections.perMinute.title}>
        <p className="text-muted-foreground">{t.sections.perMinute.body}</p>
      </Section>

      <Section title={t.sections.perDay.title}>
        <p className="text-muted-foreground">{t.sections.perDay.body}</p>
      </Section>

      <Section title={t.sections.headers.title}>
        <p className="text-muted-foreground">{t.sections.headers.body}</p>
        <DocsTable columns={["Header", ""]} rows={t.sections.headers.rows.map((r) => ({ name: r.name, description: r.description }))} />
      </Section>

      <Section title={t.sections.plans.title}>
        <p className="text-muted-foreground">{t.sections.plans.body}</p>
        <DocsTable
          columns={["Plan", "Per minute", "Per day"]}
          rows={t.sections.plans.rows.map((r) => ({ plan: r.plan, perMinute: r.perMinute, perDay: r.perDay }))}
        />
      </Section>
    </div>
  );
}
