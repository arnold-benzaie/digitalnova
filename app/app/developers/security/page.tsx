import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Section } from "@/components/developer-portal/docs-blocks";

/**
 * Public-safe summary derived from lib/api-v1/SECURITY.md — deliberately
 * NOT a straight copy: internal implementation detail (e.g. the exact
 * SSRF blocklist logic in lib/integrations/url-security.ts, the decoy-hash
 * timing-safety technique) stays out of a page an attacker could also
 * read. See the architecture plan's Group I for why this is a distinct
 * editorial pass, not a re-export.
 */
export default async function SecurityPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.security;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="text-base text-pm-gris">{t.subtitle}</p>
      </div>

      <Section title={t.sections.keys.title}>
        <p className="text-pm-gris">{t.sections.keys.body}</p>
      </Section>
      <Section title={t.sections.isolation.title}>
        <p className="text-pm-gris">{t.sections.isolation.body}</p>
      </Section>
      <Section title={t.sections.transport.title}>
        <p className="text-pm-gris">{t.sections.transport.body}</p>
      </Section>
      <Section title={t.sections.limits.title}>
        <p className="text-pm-gris">{t.sections.limits.body}</p>
      </Section>
      <Section title={t.sections.disclosure.title}>
        <p className="text-pm-gris">{t.sections.disclosure.body}</p>
      </Section>
    </div>
  );
}
