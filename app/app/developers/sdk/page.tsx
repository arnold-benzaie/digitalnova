import Link from "next/link";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { CodeBlock } from "@/components/developer-portal/docs-blocks";

export default async function SdkPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.sdkPage;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="text-base text-pm-gris">{t.subtitle}</p>
        <span className="w-fit rounded-full bg-pm-or/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-pm-or-2">
          {t.preReleaseNotice}
        </span>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.typescript.title}</h2>
        <p className="text-sm text-pm-gris">{t.typescript.description}</p>
        <CodeBlock>{t.typescript.install}</CodeBlock>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.python.title}</h2>
        <p className="text-sm text-pm-gris">{t.python.description}</p>
        <CodeBlock>{t.python.install}</CodeBlock>
      </section>

      <Link href="/developers/docs/sdk-usage" className="text-sm font-semibold text-pm-noir hover:underline">
        {t.readMore}
      </Link>
    </div>
  );
}
