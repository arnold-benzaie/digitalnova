import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { MessageThread } from "@/components/message-thread";
import { SendMessageForm } from "@/components/send-message-form";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { APP_NAME } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";

export default async function MessagesPage() {
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].dashboard.messages;
  const thread = await db
    .select()
    .from(messages)
    .where(eq(messages.organizationId, org.id))
    .orderBy(asc(messages.createdAt));

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.lead(APP_NAME)} />

      <div className="mt-6">
        <MessageThread messages={thread} locale={locale} />
      </div>

      <div className={`mt-4 ${panelClass}`}>
        <SendMessageForm locale={locale} />
      </div>
    </>
  );
}
