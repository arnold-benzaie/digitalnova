import { desc } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { notificationVisibilityWhere } from "@/lib/notification-visibility";
import { requireSession } from "@/lib/session";
import { NotificationsList } from "@/components/notifications-list";
import { AdminPageHero } from "@/components/admin/page-hero";

export default async function NotificationsPage() {
  const [org, session, locale] = await Promise.all([getOrCreateDevOrganization(), requireSession(), getLocale()]);
  const t = dictionaries[locale].notificationsPage;
  const items = await db
    .select()
    .from(notifications)
    .where(notificationVisibilityWhere(org.id, session.userId, session.role))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  return (
    <>
      <AdminPageHero title={dictionaries[locale].navigation.bell.heading} subtitle={t.subtitle} />
      <NotificationsList items={items} locale={locale} base="/dashboard" />
    </>
  );
}
