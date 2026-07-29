import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Callout, Section } from "@/components/developer-portal/docs-blocks";

/**
 * Documentation-only page — unlike n8n/Make/Airtable, there is no single
 * file to download or paste: the Zapier integration is a real Node
 * package (zapier/) meant to be pushed via the Zapier CLI once a real
 * developer account exists (see zapier/README.md). This page summarizes
 * what's built, what's explicitly not (instant triggers), and what
 * remains only on Zapier's own platform.
 */
export default async function ZapierAppPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.zapierAppPage;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-base text-muted-foreground">{t.subtitle}</p>
      </div>

      <Callout tone="warning">{t.notPublishedNotice}</Callout>

      <Section title={t.triggersTitle}>
        <p className="font-medium text-foreground">{t.triggersAvailableTitle}</p>
        <ul className="flex flex-col gap-1 pl-1 text-muted-foreground">
          {t.triggersAvailable.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="text-pm-g-green">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-medium text-foreground">{t.triggersImpossibleTitle}</p>
        <p className="text-muted-foreground">{t.triggersImpossibleNotice}</p>
      </Section>

      <Section title={t.searchesTitle}>
        <ul className="flex flex-col gap-1 pl-1 text-muted-foreground">
          {t.searches.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t.createsTitle}>
        <ul className="flex flex-col gap-1 pl-1 text-muted-foreground">
          {t.creates.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t.validationTitle}>
        <p className="text-muted-foreground">{t.validationNotice}</p>
      </Section>

      <Section title={t.nextStepsTitle}>
        <ol className="flex flex-col gap-2 text-muted-foreground">
          {t.nextSteps.map((step, i) => (
            <li key={step} className="flex gap-2">
              <span className="font-semibold text-muted-foreground">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
