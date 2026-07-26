"use server";

import { and, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditIssues, audits, locationMetrics, locations, reviews } from "@/db/schema";
import { getAIProvider } from "@/lib/ai";
import { logAudit } from "@/lib/audit";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { notify } from "@/lib/notifications";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { noLocationConnected: "Aucun établissement connecté — connectez Google Business Profile d'abord." },
  en: { noLocationConnected: "No location connected — connect Google Business Profile first." },
} as const;

export async function runAudit() {
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);

  const orgLocations = await db
    .select()
    .from(locations)
    .where(eq(locations.organizationId, org.id));

  if (orgLocations.length === 0) {
    throw new Error(MESSAGES[locale].noLocationConnected);
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  let totalViews = 0;
  let totalCalls = 0;
  let totalDirectionRequests = 0;
  let totalRating = 0;
  let reviewCount = 0;

  for (const location of orgLocations) {
    const metrics = await db
      .select()
      .from(locationMetrics)
      .where(and(eq(locationMetrics.locationId, location.id), gte(locationMetrics.date, since)));

    for (const day of metrics) {
      totalViews += day.views;
      totalCalls += day.calls;
      totalDirectionRequests += day.directionRequests;
    }

    const locationReviews = await db
      .select()
      .from(reviews)
      .where(eq(reviews.locationId, location.id));

    for (const review of locationReviews) {
      totalRating += review.rating;
      reviewCount += 1;
    }
  }

  const averageRating = reviewCount > 0 ? totalRating / reviewCount : 0;
  const dayCount = 30 * orgLocations.length;

  const aiProvider = getAIProvider();
  const result = await aiProvider.generateAudit({
    locationName:
      orgLocations.length === 1 ? orgLocations[0].name : `${orgLocations.length} établissements`,
    metrics: {
      views: totalViews / dayCount,
      calls: totalCalls / dayCount,
      directionRequests: totalDirectionRequests / dayCount,
    },
    reviewCount,
    averageRating,
  });

  const [audit] = await db
    .insert(audits)
    .values({
      organizationId: org.id,
      score: result.score,
      summary: result.summary,
    })
    .returning();

  for (const issue of result.issues) {
    await db.insert(auditIssues).values({
      auditId: audit.id,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      recommendation: issue.recommendation,
    });
  }

  await logAudit({
    organizationId: org.id,
    action: "audit.generated",
    targetType: "audit",
    targetId: audit.id,
    metadata: { score: result.score },
  });

  await notify({
    organizationId: org.id,
    type: "audit.generated",
    metadata: { score: result.score },
    rawBody: result.summary,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/audits");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}
