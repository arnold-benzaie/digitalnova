import Link from "next/link";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Callout, DocsPageHeader, Section } from "@/components/developer-portal/docs-blocks";

/**
 * Stage 6 (Groupe H of the architecture plan) — a POLICY document, not a
 * new capability: no code changes back this page. Explicitly framed as a
 * draft submitted for internal review (see draftNotice) per the plan's
 * own risk note — committing to a deprecation policy before a single
 * version transition has happened is speculative, so this is presented
 * as intent, not a binding contract.
 */
export default async function VersioningPolicyPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.versioningPolicy;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <Callout tone="warning">{t.draftNotice}</Callout>

      <Section title={t.sections.scheme.title}>
        <p className="text-muted-foreground">{t.sections.scheme.body}</p>
      </Section>
      <Section title={t.sections.nonBreaking.title}>
        <p className="text-muted-foreground">{t.sections.nonBreaking.body}</p>
      </Section>
      <Section title={t.sections.breaking.title}>
        <p className="text-muted-foreground">{t.sections.breaking.body}</p>
      </Section>
      <Section title={t.sections.deprecation.title}>
        <p className="text-muted-foreground">{t.sections.deprecation.body}</p>
      </Section>
      <Section title={t.sections.communication.title}>
        <p className="text-muted-foreground">{t.sections.communication.body}</p>
      </Section>

      <Link href="/developers/docs/changelog" className="w-fit text-sm font-medium text-foreground underline underline-offset-2">
        {t.changelogLink}
      </Link>
    </div>
  );
}
