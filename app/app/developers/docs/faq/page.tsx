import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader } from "@/components/developer-portal/docs-blocks";

export default async function FaqPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.faq;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />
      <div className="flex flex-col gap-4">
        {t.items.map((item) => (
          <div key={item.q} className="rounded-2xl border border-border bg-card p-6">
            <p className="font-semibold text-foreground">{item.q}</p>
            <p className="mt-2 text-sm text-muted-foreground">{item.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
