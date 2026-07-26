import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { MessageThread } from "@/components/message-thread";
import { SendMessageForm } from "@/components/send-message-form";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function AdminMessagesPage() {
  await requireStaffRole();

  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].settings.adminMessages;
  const thread = await db
    .select()
    .from(messages)
    .where(eq(messages.organizationId, org.id))
    .orderBy(asc(messages.createdAt));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title(org.name)}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.lead}</p>

      <div className="mt-6">
        <MessageThread messages={thread} locale={locale} />
      </div>

      <div className="mt-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
        <SendMessageForm locale={locale} />
      </div>
    </>
  );
}
