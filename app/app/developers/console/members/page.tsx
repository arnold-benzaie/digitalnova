import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { listOrgMembers } from "@/lib/developer-console/queries";
import { formatDate } from "@/lib/i18n/format";

export default async function DeveloperConsoleMembersPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = dictionaries[locale].developerConsole.members;
  const members = await listOrgMembers(session.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="text-sm text-pm-gris">{t.subtitle}</p>
      </div>

      <p className="rounded-2xl bg-pm-gris-2/20 p-4 text-xs text-pm-gris">{t.accessNote}</p>

      {members.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="text-sm text-pm-gris">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.name}</th>
                <th className="px-5 py-3">{t.columns.email}</th>
                <th className="px-5 py-3">{t.columns.role}</th>
                <th className="px-5 py-3">{t.columns.memberSince}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId} className="border-t border-pm-gris-2 align-top">
                  <td className="px-5 py-3 text-pm-noir">{member.fullName ?? "—"}</td>
                  <td className="px-5 py-3 text-pm-gris">{member.email}</td>
                  <td className="px-5 py-3 text-pm-gris">{t.roleLabels[member.role] ?? member.role}</td>
                  <td className="px-5 py-3 text-pm-gris">{formatDate(member.memberSince.toISOString(), locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
