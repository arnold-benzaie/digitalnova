import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { CreateAuditForm } from "@/components/gbp-audit/create-audit-form";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function NewAuditPage() {
  await requireAuditStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.createAudit;

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="mt-1 text-sm text-pm-gris">{t.lead}</p>
      </div>
      <CreateAuditForm locale={locale} />
    </>
  );
}
