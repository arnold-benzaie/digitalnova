import { db } from "@/db";
import { notifications } from "@/db/schema";

type NotifyInput = {
  organizationId: string;
  type: string;
  title: string;
  body?: string;
};

/**
 * In-app notification center only — email delivery is deferred until an
 * email provider (Resend/Postmark, per the architecture plan) is wired up.
 */
export async function notify(input: NotifyInput) {
  await db.insert(notifications).values({
    organizationId: input.organizationId,
    type: input.type,
    title: input.title,
    body: input.body,
  });
}
