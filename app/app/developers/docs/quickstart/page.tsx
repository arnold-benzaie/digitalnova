import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { CodeBlock, DocsPageHeader, Section } from "@/components/developer-portal/docs-blocks";

export default async function QuickstartPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.quickstart;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <Section title={t.steps.step1.title}>
        <p className="text-pm-gris">{t.steps.step1.body}</p>
        <p className="text-xs font-semibold text-pm-or-2">{t.steps.step1.note}</p>
      </Section>

      <Section title={t.steps.step2.title}>
        <p className="text-pm-gris">{t.steps.step2.body}</p>
        <CodeBlock>{t.curl.ping}</CodeBlock>
      </Section>

      <Section title={t.steps.step3.title}>
        <p className="text-pm-gris">{t.steps.step3.body}</p>
        <CodeBlock>{t.curl.pingResponse}</CodeBlock>
      </Section>

      <Section title={t.steps.step4.title}>
        <p className="text-pm-gris">{t.steps.step4.body}</p>
        <CodeBlock>{t.curl.audits}</CodeBlock>
      </Section>

      <Section title={t.steps.step5.title}>
        <p className="text-pm-gris">{t.steps.step5.body}</p>
      </Section>
    </div>
  );
}
