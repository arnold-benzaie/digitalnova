import { desc, eq } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditNotifications } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { NotificationRow } from "@/components/gbp-audit/notification-row";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function AuditNotificationsPage() {
  const session = await requireAuditStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.notificationsPage;

  const items = await auditDb
    .select()
    .from(auditNotifications)
    .where(eq(auditNotifications.recipientUserId, session.userId))
    .orderBy(desc(auditNotifications.createdAt))
    .limit(100);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.lead}</p>

      {items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            title={t.emptyTitle}
            description={t.emptyDescription}
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={{ id: item.id, title: item.title, body: item.body, href: item.href, read: item.readAt !== null, createdAt: item.createdAt.toISOString() }}
              locale={locale}
            />
          ))}
        </div>
      )}
    </>
  );
}
