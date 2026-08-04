import Link from "next/link";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";
import { listOrganizationsWithIntegrationCounts } from "@/lib/integrations/queries";
import { AdminPageHero } from "@/components/admin/page-hero";

export default async function IntegrationsOrgPickerPage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].integrations.orgPicker;

  const orgs = await listOrganizationsWithIntegrationCounts();

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      {orgs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.name}</th>
                <th className="px-5 py-3">{t.columns.integrations}</th>
                <th className="px-5 py-3">{t.columns.endpoints}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 font-medium text-pm-noir">{org.name}</td>
                  <td className="px-5 py-3 text-pm-gris">{formatNumber(org.integrationCount, locale)}</td>
                  <td className="px-5 py-3 text-pm-gris">{formatNumber(org.endpointCount, locale)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/admin/integrations/${org.id}`} className="font-medium text-pm-noir underline underline-offset-2 hover:no-underline">
                      {t.open}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
