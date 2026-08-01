import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { memberships, onboarding, roles, users } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { getOnboardingQuestions } from "@/lib/onboarding-questions";

/**
 * Reached by clicking an "onboarding.completed" notification (see
 * lib/notification-href.ts) or navigating directly — no dynamic segment
 * needed: every admin/staff session is already scoped to exactly one
 * organization (same pattern as /admin/notifications, /admin/audit,
 * /admin/crm), so this resolves that same organization, mirroring those
 * pages exactly rather than expecting an id to travel through the
 * notification.
 */
export default async function AdminOnboardingPage() {
  await requireStaffRole();
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].adminOnboarding;

  const [record] = await db.select().from(onboarding).where(eq(onboarding.organizationId, org.id)).limit(1);

  const clientMembers = await db
    .select({ fullName: users.fullName, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(and(eq(memberships.organizationId, org.id), eq(roles.name, "client")));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.lead}</p>

      {!record || !record.completedAt ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.clientLabel}</div>
              {clientMembers.length > 0 ? (
                clientMembers.map((m, i) => (
                  <p key={i} className="mt-1 text-sm text-pm-noir">
                    {m.fullName ?? "—"} <span className="text-pm-gris">— {m.email}</span>
                  </p>
                ))
              ) : (
                <p className="mt-1 text-sm text-pm-gris">{t.noClientFound}</p>
              )}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.organizationLabel}</div>
              <p className="mt-1 text-sm text-pm-noir">{org.name}</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.submittedLabel}</div>
              <p className="mt-1 text-sm text-pm-noir">{formatDateTime(record.completedAt, locale)}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/admin/messages"
              className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
            >
              {t.contactClient}
            </Link>
            <Link
              href="/admin/audit/nouveau"
              className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/40"
            >
              {t.createAudit}
            </Link>
          </div>

          {record.summary && (
            <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.summaryTitle}</h2>
              <p className="mt-2 text-sm text-pm-noir">{record.summary}</p>
            </div>
          )}

          {record.nextStep && (
            <div className="mt-4 rounded-2xl border border-pm-gris-2 bg-white p-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.nextStepTitle}</h2>
              <p className="mt-2 text-sm text-pm-noir">{record.nextStep}</p>
            </div>
          )}

          <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.answersTitle}</h2>
          <div className="mt-3 flex flex-col gap-3">
            {getOnboardingQuestions(locale).map((question) => {
              const answer = (record.answers as Record<string, string>)[question.key];
              if (!answer) return null;
              return (
                <div key={question.key} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
                  <p className="text-sm font-medium text-pm-noir">{question.label}</p>
                  <p className="mt-1 text-sm text-pm-gris">{answer}</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
