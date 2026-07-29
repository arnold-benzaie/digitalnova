import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Callout, DocsPageHeader, DocsTable, Section } from "@/components/developer-portal/docs-blocks";

/**
 * Stage 7 (architecture plan) — "note de conception « extension du
 * catalogue d'événements » (prérequis léger du Groupe G, pas son
 * implémentation complète)". Pure design note: lib/integrations/
 * governance.ts's INTEGRATION_EVENT_CATALOG is untouched by this stage —
 * see t.notImplementedNotice. Every candidate event and its trigger point
 * below was verified against the real code (lib/actions/crm-*.ts,
 * lib/actions/billing.ts) before being proposed, not invented.
 */
export default async function EventCatalogDesignNotePage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.eventCatalogDesign;

  const columns = [t.sections.candidatesColumns.event, t.sections.candidatesColumns.trigger, t.sections.candidatesColumns.fields, t.sections.candidatesColumns.notes];

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <Callout tone="warning">{t.notImplementedNotice}</Callout>

      <Section title={t.sections.context.title}>
        <p className="text-muted-foreground">{t.sections.context.body}</p>
      </Section>
      <Section title={t.sections.orgScopingWarning.title}>
        <p className="text-muted-foreground">{t.sections.orgScopingWarning.body}</p>
      </Section>
      <Section title={t.sections.existingInfra.title}>
        <p className="text-muted-foreground">{t.sections.existingInfra.body}</p>
      </Section>
      <Section title={t.sections.separateAuditSystem.title}>
        <p className="text-muted-foreground">{t.sections.separateAuditSystem.body}</p>
      </Section>

      <Section title={t.sections.candidatesTitle}>
        <DocsTable columns={columns} rows={t.sections.candidates} />
      </Section>

      <Section title={t.sections.namingAndVersioning.title}>
        <p className="text-muted-foreground">{t.sections.namingAndVersioning.body}</p>
      </Section>
      <Section title={t.sections.dataMinimization.title}>
        <p className="text-muted-foreground">{t.sections.dataMinimization.body}</p>
      </Section>

      <Section title={t.sections.priority.title}>
        <p className="font-medium text-foreground">{t.sections.priority.p0Title}</p>
        <ul className="flex flex-col gap-1 pl-1 text-muted-foreground">
          {t.sections.priority.p0.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="text-pm-g-green">✓</span>
              <span className="font-mono text-sm">{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 font-medium text-foreground">{t.sections.priority.p1Title}</p>
        <ul className="flex flex-col gap-1 pl-1 text-muted-foreground">
          {t.sections.priority.p1.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="text-pm-or">○</span>
              <span className="font-mono text-sm">{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t.sections.openQuestions.title}>
        <ul className="flex flex-col gap-2 text-muted-foreground">
          {t.sections.openQuestions.items.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden>?</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
