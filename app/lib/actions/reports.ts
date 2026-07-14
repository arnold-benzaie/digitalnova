"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { reportSchedules } from "@/db/schema";
import { computeNextRun, FREQUENCY_DAYS } from "@/lib/report-schedule";
import { getOrCreateDevOrganization } from "@/lib/dev-org";

export async function updateReportSchedule(formData: FormData) {
  const frequency = formData.get("frequency");
  const enabled = formData.get("enabled") === "on";
  const freq = typeof frequency === "string" && FREQUENCY_DAYS[frequency] ? frequency : "monthly";

  const org = await getOrCreateDevOrganization();

  await db
    .insert(reportSchedules)
    .values({
      organizationId: org.id,
      frequency: freq,
      enabled,
      nextRunAt: enabled ? computeNextRun(freq) : null,
    })
    .onConflictDoUpdate({
      target: reportSchedules.organizationId,
      set: { frequency: freq, enabled, nextRunAt: enabled ? computeNextRun(freq) : null },
    });

  revalidatePath("/dashboard/settings");
}
