"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { onboarding } from "@/db/schema";
import { getAIProvider } from "@/lib/ai";
import { logAudit } from "@/lib/audit";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { notify } from "@/lib/notifications";

export async function completeOnboarding(answers: Record<string, string>) {
  const org = await getOrCreateDevOrganization();
  const aiProvider = getAIProvider();
  const { summary, nextStep } = await aiProvider.summarizeOnboarding(answers);

  await db
    .insert(onboarding)
    .values({
      organizationId: org.id,
      answers,
      summary,
      nextStep,
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: onboarding.organizationId,
      set: { answers, summary, nextStep, completedAt: new Date() },
    });

  await logAudit({
    organizationId: org.id,
    action: "onboarding.completed",
    targetType: "organization",
    targetId: org.id,
  });

  await notify({
    organizationId: org.id,
    type: "onboarding.completed",
    metadata: {},
    // Client-facing notification body stays the combined text (same
    // wording as before this split) — only the admin detail page shows
    // summary/nextStep as separate sections.
    rawBody: `${summary} ${nextStep}`,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/onboarding");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}
