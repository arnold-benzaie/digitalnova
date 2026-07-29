import Link from "next/link";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { CodeBlock, SoonNotice } from "@/components/developer-portal/docs-blocks";

export default async function SdkPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.sdkPage;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-base text-muted-foreground">{t.subtitle}</p>
        <SoonNotice label={t.preReleaseNotice} />
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.typescript.title}</h2>
        <p className="text-sm text-muted-foreground">{t.typescript.description}</p>
        <CodeBlock>{t.typescript.install}</CodeBlock>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.python.title}</h2>
        <p className="text-sm text-muted-foreground">{t.python.description}</p>
        <CodeBlock>{t.python.install}</CodeBlock>
      </section>

      <Link href="/developers/docs/sdk-usage" className="w-fit text-sm font-semibold text-foreground underline underline-offset-2">
        {t.readMore}
      </Link>
    </div>
  );
}
