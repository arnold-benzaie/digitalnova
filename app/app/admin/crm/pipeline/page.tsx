import { asc } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, deals } from "@/db/schema";
import { CreateDealForm } from "@/components/crm/create-deal-form";
import { PipelineBoard } from "@/components/crm/pipeline-board";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";

export default async function CrmPipelinePage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].crm.pipeline;

  const [allDeals, allClients] = await Promise.all([
    db.select().from(deals).orderBy(asc(deals.createdAt)),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
  ]);

  const clientNameById = Object.fromEntries(allClients.map((c) => [c.id, c.name]));

  return (
    <>
      <AdminPageHero
        title={t.title}
        subtitle={t.summary(allDeals.length, formatNumber(allDeals.reduce((sum, d) => sum + d.valueEuros, 0), locale))}
      />

      <div className={`mt-6 ${panelClass}`}>
        <CreateDealForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} locale={locale} />
      </div>

      <PipelineBoard
        deals={allDeals.map((d) => ({ ...d, expectedCloseDate: d.expectedCloseDate?.toISOString() ?? null }))}
        clientNameById={clientNameById}
        locale={locale}
      />
    </>
  );
}
