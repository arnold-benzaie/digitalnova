import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader, OrderedSteps, Section } from "@/components/developer-portal/docs-blocks";

/**
 * OAuth-provider DESIGN NOTE (Stage 6, Groupe H item 19) — deliberately
 * no implementation: no route, no token table, no consent UI exists
 * anywhere in this codebase. lib/google/oauth.ts is referenced only as a
 * STYLE precedent (per the architecture plan) for how this app already
 * models an OAuth2 flow — PUBLIC-MAP is the CLIENT there; this document
 * considers the reverse role. See t.rolesReversal for that distinction
 * spelled out in the page copy itself, not just this comment.
 */
export default async function OAuthDesignNotePage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.oauthDesign;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <div className="rounded-2xl border border-pm-or/30 bg-pm-or/10 p-6">
        <p className="text-sm text-pm-noir">{t.notImplementedNotice}</p>
      </div>

      <Section title={t.sections.why.title}>
        <p className="text-pm-gris">{t.sections.why.body}</p>
      </Section>
      <Section title={t.sections.rolesReversal.title}>
        <p className="text-pm-gris">{t.sections.rolesReversal.body}</p>
      </Section>
      <Section title={t.sections.scopes.title}>
        <p className="text-pm-gris">{t.sections.scopes.body}</p>
      </Section>
      <Section title={t.sections.flow.title}>
        <OrderedSteps steps={t.sections.flow.steps} />
      </Section>
      <Section title={t.sections.revocation.title}>
        <p className="text-pm-gris">{t.sections.revocation.body}</p>
      </Section>
      <Section title={t.sections.openQuestions.title}>
        <ul className="flex flex-col gap-2 text-pm-gris">
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
