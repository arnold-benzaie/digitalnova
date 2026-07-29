import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader, DocsTable, Section } from "@/components/developer-portal/docs-blocks";

export default async function AuthenticationPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.authentication;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <Section title={t.sections.headers.title}>
        <p className="text-pm-gris">{t.sections.headers.body}</p>
        <DocsTable columns={["Header", ""]} rows={t.sections.headers.rows.map((r) => ({ name: r.name, description: r.description }))} />
      </Section>

      <Section title={t.sections.format.title}>
        <p className="text-pm-gris">{t.sections.format.body}</p>
      </Section>

      <Section title={t.sections.scopes.title}>
        <p className="text-pm-gris">{t.sections.scopes.body}</p>
        <DocsTable columns={["Scope", ""]} rows={t.sections.scopes.rows.map((r) => ({ scope: r.scope, description: r.description }))} />
      </Section>

      <Section title={t.sections.isolation.title}>
        <p className="text-pm-gris">{t.sections.isolation.body}</p>
      </Section>

      <Section title={t.sections.lifecycle.title}>
        <p className="text-pm-gris">{t.sections.lifecycle.body}</p>
      </Section>
    </div>
  );
}
