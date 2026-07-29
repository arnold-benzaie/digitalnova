import Link from "next/link";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Callout, DocsPageHeader, Section } from "@/components/developer-portal/docs-blocks";

export default async function WebhooksGuidePage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.webhooksGuide;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />

      <Callout tone="warning">
        <p>{t.selfServiceNotice}</p>
        <Link href="/developers/console/webhooks" className="w-fit text-sm font-semibold text-foreground underline underline-offset-2">
          {t.consoleToolsLink}
        </Link>
      </Callout>

      <Section title={t.sections.overview.title}>
        <p className="text-muted-foreground">{t.sections.overview.body}</p>
      </Section>
      <Section title={t.sections.signing.title}>
        <p className="text-muted-foreground">{t.sections.signing.body}</p>
      </Section>
      <Section title={t.sections.retry.title}>
        <p className="text-muted-foreground">{t.sections.retry.body}</p>
      </Section>
      <Section title={t.sections.history.title}>
        <p className="text-muted-foreground">{t.sections.history.body}</p>
      </Section>
    </div>
  );
}
