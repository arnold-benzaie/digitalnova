"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { gbpConnections, locationMetrics, locations, reviews } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getGbpProvider } from "@/lib/gbp";
import { notify } from "@/lib/notifications";

export async function connectGbp() {
  const org = await getOrCreateDevOrganization();
  const provider = getGbpProvider();
  const remoteLocations = await provider.listLocations();

  await db
    .insert(gbpConnections)
    .values({
      organizationId: org.id,
      status: "connected",
      googleAccountEmail: "demo@public-map.com",
      connectedAt: new Date(),
    })
    .onConflictDoNothing();

  for (const remoteLocation of remoteLocations) {
    await db
      .insert(locations)
      .values({
        organizationId: org.id,
        googleLocationId: remoteLocation.googleLocationId,
        name: remoteLocation.name,
        address: remoteLocation.address,
        category: remoteLocation.category,
      })
      .onConflictDoNothing();
  }

  await logAudit({
    organizationId: org.id,
    action: "gbp.connected",
    targetType: "organization",
    targetId: org.id,
    metadata: { locationCount: remoteLocations.length },
  });

  await syncGbpData();
}

export async function syncGbpData() {
  const org = await getOrCreateDevOrganization();
  const provider = getGbpProvider();

  const orgLocations = await db
    .select()
    .from(locations)
    .where(eq(locations.organizationId, org.id));

  for (const location of orgLocations) {
    const metrics = await provider.getMetrics(location.googleLocationId, 30);
    for (const day of metrics) {
      await db
        .insert(locationMetrics)
        .values({
          locationId: location.id,
          date: new Date(day.date),
          views: day.views,
          calls: day.calls,
          directionRequests: day.directionRequests,
          websiteClicks: day.websiteClicks,
        })
        .onConflictDoNothing();
    }

    const remoteReviews = await provider.getReviews(location.googleLocationId);
    for (const review of remoteReviews) {
      await db
        .insert(reviews)
        .values({
          locationId: location.id,
          googleReviewId: review.googleReviewId,
          authorName: review.authorName,
          rating: review.rating,
          comment: review.comment,
          publishedAt: new Date(review.publishedAt),
        })
        .onConflictDoNothing();
    }
  }

  await logAudit({
    organizationId: org.id,
    action: "gbp.synced",
    targetType: "organization",
    targetId: org.id,
    metadata: { locationCount: orgLocations.length },
  });

  await notify({
    organizationId: org.id,
    type: "gbp.synced",
    title: "Synchronisation Google Business Profile effectuée",
    body: `${orgLocations.length} établissement(s) mis à jour.`,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/gbp");
  revalidatePath("/dashboard/audits");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}
