import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { MessageThread } from "@/components/message-thread";
import { SendMessageForm } from "@/components/send-message-form";
import { getOrCreateDevOrganization } from "@/lib/dev-org";

export default async function MessagesPage() {
  const org = await getOrCreateDevOrganization();
  const thread = await db
    .select()
    .from(messages)
    .where(eq(messages.organizationId, org.id))
    .orderBy(asc(messages.createdAt));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Messagerie</h1>
      <p className="mt-2 text-sm text-pm-gris">Échangez directement avec votre conseiller Public Maps.</p>

      <div className="mt-6">
        <MessageThread messages={thread} />
      </div>

      <div className="mt-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
        <SendMessageForm />
      </div>
    </>
  );
}
