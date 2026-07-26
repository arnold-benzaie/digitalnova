import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { renderNotification } from "@/lib/i18n/notification-templates";

export default async function AdminNotificationsPage() {
  await requireStaffRole();

  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].notificationsPage;
  const items = await db
    .select()
    .from(notifications)
    .where(eq(notifications.organizationId, org.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title(org.name)}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.subtitle}</p>

      {items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {items.map((item) => {
            const rendered = renderNotification(item, locale);
            return (
              <div key={item.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm font-medium text-pm-noir">{rendered.title}</p>
                  <p className="shrink-0 text-xs text-pm-gris">{formatDate(item.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
                {rendered.body && <p className="mt-1 text-sm text-pm-gris">{rendered.body}</p>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
