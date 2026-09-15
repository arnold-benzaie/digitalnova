import type { EmployeeColleague } from "@/lib/actions/employee-colleagues";
import { panelClass } from "@/components/admin/page-hero";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

/**
 * WORKFORCE — EMPLOYEE "MES COLLÈGUES" — strictly presentational, strictly
 * read-only. No form, no button, no Server Action reference of any kind —
 * this component cannot suspend/reactivate/offboard/change-role/toggle
 * RADAR access; it only ever renders the `{ userId, displayName, role }[]`
 * its caller already fetched via listEmployeeColleagues()
 * (lib/actions/employee-colleagues.ts), which is itself the only place
 * authorization/filtering happens. Rendering this component for the wrong
 * viewer would be a caller bug, not a security boundary — the real
 * boundary is server-side (see that function's own doc comment).
 *
 * Deliberately its own component, not a reuse of ManagerTeamPanel: the
 * copy ("Mes collègues") must never read as MANAGER's own "Mon équipe" —
 * an EMPLOYEE must never see MANAGER's team-management framing.
 */
export function EmployeeColleaguesPanel({ colleagues, locale }: { colleagues: EmployeeColleague[]; locale: Locale }) {
  const t = dictionaries[locale].employee;

  return (
    <div className={`${panelClass} mt-6`}>
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.colleaguesTitle}</h2>
      <p className="mt-1 text-xs uppercase tracking-wide text-pm-gris">{t.colleaguesSubtitle}</p>

      {colleagues.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">{t.colleaguesEmptyState}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {colleagues.map((c) => (
            <li key={c.userId} className="text-sm text-pm-noir">
              {c.displayName} — {t.colleaguesRoleEmployee}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
