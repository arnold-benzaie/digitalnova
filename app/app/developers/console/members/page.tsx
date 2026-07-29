import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { listOrgMembers } from "@/lib/developer-console/queries";
import { formatDate } from "@/lib/i18n/format";
import { FadeIn } from "@/components/developer-portal/motion/fade-in";

export default async function DeveloperConsoleMembersPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = dictionaries[locale].developerConsole.members;
  const members = await listOrgMembers(session.organizationId);

  return (
    <FadeIn className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      <p className="rounded-2xl bg-muted/20 p-4 text-xs text-muted-foreground">{t.accessNote}</p>

      {members.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3">{t.columns.name}</th>
                <th className="px-5 py-3">{t.columns.email}</th>
                <th className="px-5 py-3">{t.columns.role}</th>
                <th className="px-5 py-3">{t.columns.memberSince}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId} className="border-t border-border align-top">
                  <td className="px-5 py-3 text-foreground">{member.fullName ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{member.email}</td>
                  <td className="px-5 py-3 text-muted-foreground">{t.roleLabels[member.role] ?? member.role}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(member.memberSince.toISOString(), locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FadeIn>
  );
}
