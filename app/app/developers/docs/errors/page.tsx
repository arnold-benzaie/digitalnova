import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader, DocsTable } from "@/components/developer-portal/docs-blocks";

export default async function ErrorsPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.errors;

  return (
    <div className="flex flex-col gap-6">
      <DocsPageHeader title={t.title} subtitle={t.subtitle} />
      <p className="text-sm text-muted-foreground">{t.intro}</p>
      <DocsTable
        columns={[t.columns.code, t.columns.status, t.columns.meaning]}
        rows={t.rows.map((r) => ({ code: r.code, status: r.status, meaning: r.meaning }))}
      />
    </div>
  );
}
