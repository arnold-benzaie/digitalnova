import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reportSchedules } from "@/db/schema";

export const FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 90 };

export function computeNextRun(frequency: string): Date {
  const days = FREQUENCY_DAYS[frequency] ?? 30;
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next;
}

export async function getReportSchedule(organizationId: string) {
  const [schedule] = await db
    .select()
    .from(reportSchedules)
    .where(eq(reportSchedules.organizationId, organizationId))
    .limit(1);
  return schedule ?? null;
}
