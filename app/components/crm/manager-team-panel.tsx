import type { ManagerTeamMember } from "@/lib/actions/manager-team";
import { panelClass } from "@/components/admin/page-hero";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

/**
 * WORKFORCE — MANAGER "MON ÉQUIPE" — strictly presentational, strictly
 * read-only. No form, no button, no Server Action reference of any kind —
 * this component cannot suspend/reactivate/offboard/change-role/toggle
 * RADAR access or assign a prospect; it only ever renders the
 * `{ userId, displayName, role }[]` its caller already fetched via
 * listManagerTeamMembers() (lib/actions/manager-team.ts), which is itself
 * the only place authorization/filtering happens. Rendering this component
 * for the wrong viewer would be a caller bug, not a security boundary —
 * the real boundary is server-side (see that function's own doc comment).
 */
export function ManagerTeamPanel({ members, locale }: { members: ManagerTeamMember[]; locale: Locale }) {
  const t = dictionaries[locale].crm.radar.myTeam;

  return (
    <div className={`${panelClass} mt-6`}>
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>
      <p className="mt-1 text-xs uppercase tracking-wide text-pm-gris">{t.subtitle}</p>

      {members.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">{t.emptyState}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {members.map((m) => (
            <li key={m.userId} className="text-sm text-pm-noir">
              {m.displayName} — {t.roleEmployee}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
