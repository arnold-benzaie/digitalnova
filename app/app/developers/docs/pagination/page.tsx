import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader, DocsTable, Section } from "@/components/developer-portal/docs-blocks";

export default async function PaginationPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.pagination;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <Section title={t.sections.cursor.title}>
        <p className="text-pm-gris">{t.sections.cursor.body}</p>
      </Section>

      <Section title={t.sections.limit.title}>
        <p className="text-pm-gris">{t.sections.limit.body}</p>
      </Section>

      <Section title={t.sections.filters.title}>
        <DocsTable columns={["Param", ""]} rows={t.sections.filters.rows.map((r) => ({ name: r.name, description: r.description }))} />
      </Section>
    </div>
  );
}
