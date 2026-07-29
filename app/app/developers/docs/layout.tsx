import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getDocsNavGroups } from "@/lib/developer-portal/nav";
import { DocsSidebar } from "@/components/developer-portal/docs-sidebar";

export default async function DevelopersDocsLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = dictionaries[locale].developers;
  const groups = getDocsNavGroups(t);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 md:flex-row">
      <aside className="shrink-0 md:w-56">
        <DocsSidebar groups={groups} soonBadge={t.header.soonBadge} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
