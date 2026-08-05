import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { CreateAuditForm } from "@/components/gbp-audit/create-audit-form";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero } from "@/components/admin/page-hero";

export default async function NewAuditPage() {
  await requireAuditStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.createAudit;

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.lead} />
      <CreateAuditForm locale={locale} />
    </>
  );
}
