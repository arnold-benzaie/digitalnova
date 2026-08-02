import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { requireSession } from "@/lib/session";
import { NotificationsList } from "@/components/notifications-list";

export default async function AdminNotificationsPage() {
  await requireStaffRole();

  const [org, session, locale] = await Promise.all([getOrCreateDevOrganization(), requireSession(), getLocale()]);
  const t = dictionaries[locale].notificationsPage;
  const items = await db
    .select()
    .from(notifications)
    .where(or(and(eq(notifications.organizationId, org.id), isNull(notifications.userId)), eq(notifications.userId, session.userId)))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title(org.name)}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.subtitle}</p>
      <NotificationsList items={items} locale={locale} base="/admin" />
    </>
  );
}
