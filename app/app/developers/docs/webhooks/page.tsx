import Link from "next/link";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader, Section } from "@/components/developer-portal/docs-blocks";

export default async function WebhooksGuidePage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.webhooksGuide;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <div className="flex flex-col gap-3 rounded-2xl border border-pm-or/30 bg-pm-or/10 p-6">
        <p className="text-sm text-pm-noir">{t.selfServiceNotice}</p>
        <Link href="/developers/console/webhooks" className="w-fit text-sm font-semibold text-pm-noir underline underline-offset-2">
          {t.consoleToolsLink}
        </Link>
      </div>

      <Section title={t.sections.overview.title}>
        <p className="text-pm-gris">{t.sections.overview.body}</p>
      </Section>
      <Section title={t.sections.signing.title}>
        <p className="text-pm-gris">{t.sections.signing.body}</p>
      </Section>
      <Section title={t.sections.retry.title}>
        <p className="text-pm-gris">{t.sections.retry.body}</p>
      </Section>
      <Section title={t.sections.history.title}>
        <p className="text-pm-gris">{t.sections.history.body}</p>
      </Section>
    </div>
  );
}
