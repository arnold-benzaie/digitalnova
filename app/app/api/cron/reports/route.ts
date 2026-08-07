import { desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { audits, organizations, reportSchedules } from "@/db/schema";
import { computeNextRun } from "@/lib/report-schedule";
import { notify } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { checkCronAuth } from "@/lib/cron-auth";

/**
 * Vercel Cron target (see vercel.json). Vercel signs cron requests with
 * `Authorization: Bearer $CRON_SECRET`. No email provider is wired up
 * (Resend/Postmark), so "delivery" means an in-app notification for now,
 * not an actual email attachment.
 */
export async function GET(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const due = await db
    .select()
    .from(reportSchedules)
    .where(lte(reportSchedules.nextRunAt, new Date()));

  const processed: string[] = [];

  for (const schedule of due) {
    if (!schedule.enabled) continue;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, schedule.organizationId)).limit(1);
    if (!org) continue;

    const [latestAudit] = await db
      .select()
      .from(audits)
      .where(eq(audits.organizationId, org.id))
      .orderBy(desc(audits.createdAt))
      .limit(1);

    await notify({
      organizationId: org.id,
      type: "report.generated",
      metadata: { frequency: schedule.frequency, score: latestAudit?.score ?? null },
    });

    await logAudit({
      organizationId: org.id,
      action: "report.auto_generated",
      targetType: "report_schedule",
      targetId: schedule.id,
      metadata: { frequency: schedule.frequency },
    });

    await db
      .update(reportSchedules)
      .set({ lastSentAt: new Date(), nextRunAt: computeNextRun(schedule.frequency) })
      .where(eq(reportSchedules.id, schedule.id));

    processed.push(org.id);
  }

  return Response.json({ processed: processed.length });
}
