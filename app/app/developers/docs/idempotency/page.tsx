import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader, Section } from "@/components/developer-portal/docs-blocks";

export default async function IdempotencyPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.idempotency;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <Section title={t.sections.howItWorks.title}>
        <p className="text-pm-gris">{t.sections.howItWorks.body}</p>
      </Section>

      <Section title={t.sections.scope.title}>
        <p className="text-pm-gris">{t.sections.scope.body}</p>
      </Section>

      <Section title={t.sections.recommendation.title}>
        <p className="text-pm-gris">{t.sections.recommendation.body}</p>
      </Section>
    </div>
  );
}
