"use server";

import { and, eq, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { gbpConnections, locationMetrics, locations, organizations, reviews } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getGbpProvider, type GbpLocation } from "@/lib/gbp";
import { getGoogleConnection, recordGbpSyncResult, sanitizeGoogleError } from "@/lib/google/oauth";
import { notify } from "@/lib/notifications";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const MESSAGES = {
  fr: {
    organizationNotFound: "Organisation introuvable.",
    noGoogleConnection: "Aucun compte Google connecté pour cette organisation. Utilisez le bouton « Connecter un compte Google ».",
    replyRequired: "La réponse ne peut pas être vide.",
    reviewNotFound: "Avis introuvable.",
    locationNotFound: "Établissement introuvable.",
  },
  en: {
    organizationNotFound: "Organization not found.",
    noGoogleConnection: "No Google account connected for this organization. Use the \"Connect a Google account\" button.",
    replyRequired: "The reply cannot be empty.",
    reviewNotFound: "Review not found.",
    locationNotFound: "Location not found.",
  },
} as const;

/** Defaults to the signed-in session's own organization (the client-portal
 * use case at /dashboard/gbp) when no id is given — pass one explicitly for
 * the CRM use case (lib/actions/crm-gbp.ts), where staff act on a specific
 * client's organization rather than their own session. */
async function resolveOrganization(organizationId: string | undefined, locale: Locale) {
  if (!organizationId) return getOrCreateDevOrganization();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new Error(MESSAGES[locale].organizationNotFound);
  return org;
}

export async function connectGbp(organizationId?: string) {
  const locale = await getLocale();
  const org = await resolveOrganization(organizationId, locale);

  const googleConnection = await getGoogleConnection(org.id);
  if (!googleConnection) {
    throw new Error(MESSAGES[locale].noGoogleConnection);
  }

  const provider = await getGbpProvider(org.id);

  // A real Google account can be connected (OAuth succeeded) while the GBP
  // API call itself still fails — most commonly because the business.manage
  // scope wasn't actually granted (Google silently drops ungranted scopes
  // rather than failing the whole consent) or the API isn't approved/enabled
  // yet. Don't let that stop the account itself from being recorded as
  // connected — surface the sanitized error via the audit log instead so
  // the status UI can show "compte connecté, GBP en attente" accurately.
  let remoteLocations: GbpLocation[] = [];
  let locationsError: ReturnType<typeof sanitizeGoogleError> | undefined;
  try {
    remoteLocations = await provider.listLocations();
  } catch (err) {
    locationsError = sanitizeGoogleError(err);
  }

  await db
    .insert(gbpConnections)
    .values({
      organizationId: org.id,
      status: "connected",
      googleAccountEmail: googleConnection.googleAccountEmail,
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: gbpConnections.organizationId,
      set: {
        status: "connected",
        googleAccountEmail: googleConnection.googleAccountEmail,
        connectedAt: new Date(),
      },
    });

  for (const remoteLocation of remoteLocations) {
    await db
      .insert(locations)
      .values({
        organizationId: org.id,
        googleLocationId: remoteLocation.googleLocationId,
        name: remoteLocation.name,
        address: remoteLocation.address,
        category: remoteLocation.category,
        phone: remoteLocation.phone ?? null,
        websiteUrl: remoteLocation.websiteUrl ?? null,
      })
      .onConflictDoUpdate({
        target: [locations.organizationId, locations.googleLocationId],
        set: {
          name: remoteLocation.name,
          address: remoteLocation.address,
          category: remoteLocation.category,
          phone: remoteLocation.phone ?? null,
          websiteUrl: remoteLocation.websiteUrl ?? null,
        },
      });
  }

  // A successful fetch is authoritative — replace any previously-stored
  // locations that are no longer in the real list (e.g. leftover demo data
  // from before this org connected a real account, or a location removed
  // on Google's side since the last sync). Skipped on error so a
  // transient API failure never wipes out good previously-fetched data.
  if (!locationsError) {
    const currentIds = remoteLocations.map((l) => l.googleLocationId);
    await db.delete(locations).where(
      currentIds.length > 0
        ? and(eq(locations.organizationId, org.id), notInArray(locations.googleLocationId, currentIds))
        : eq(locations.organizationId, org.id),
    );
  }

  if (locationsError) {
    await logAudit({
      organizationId: org.id,
      action: "gbp.connect_error",
      targetType: "organization",
      targetId: org.id,
      metadata: locationsError,
    });
  }

  // syncGbpData() below only overwrites this when it actually processed
  // >0 locations — with 0 locations (this exact error case), it leaves
  // this result untouched, so the connect-time error is what the status
  // UI ends up showing rather than being silently cleared.
  await recordGbpSyncResult(org.id, locationsError ? locationsError.message : null);

  await logAudit({
    organizationId: org.id,
    action: "gbp.connected",
    targetType: "organization",
    targetId: org.id,
    metadata: { locationCount: remoteLocations.length },
  });

  await dispatchWebhookEvent("gbp.connected", { organizationId: org.id, locationCount: remoteLocations.length });

  await syncGbpData(org.id);
}

export async function syncGbpData(organizationId?: string) {
  const locale = await getLocale();
  const org = await resolveOrganization(organizationId, locale);
  const provider = await getGbpProvider(org.id);

  const orgLocations = await db.select().from(locations).where(eq(locations.organizationId, org.id));

  let newReviewCount = 0;
  let reviewsUnavailable = false;
  let metricsUnavailable = false;
  let lastError: ReturnType<typeof sanitizeGoogleError> | undefined;
  for (const location of orgLocations) {
    // Both calls can fail independently (missing scope, API not yet
    // enabled/approved, etc.) — neither should block the other or stop the
    // rest of the org's locations from syncing.
    try {
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
    } catch (err) {
      metricsUnavailable = true;
      lastError = sanitizeGoogleError(err);
    }

    // The real provider throws here (Google restricts the reviews API to
    // approved partners — see lib/gbp/real-provider.ts).
    try {
      const remoteReviews = await provider.getReviews(location.googleLocationId);
      for (const review of remoteReviews) {
        // onConflictDoNothing().returning() gives back the row only when it
        // was actually inserted (empty array on conflict) — a cheap way to
        // count genuinely new reviews without a separate existence check.
        const inserted = await db
          .insert(reviews)
          .values({
            locationId: location.id,
            googleReviewId: review.googleReviewId,
            authorName: review.authorName,
            rating: review.rating,
            comment: review.comment,
            publishedAt: new Date(review.publishedAt),
          })
          .onConflictDoNothing()
          .returning({ id: reviews.id });
        if (inserted.length > 0) newReviewCount += 1;
      }
    } catch (err) {
      reviewsUnavailable = true;
      lastError = lastError ?? sanitizeGoogleError(err);
    }
  }

  await logAudit({
    organizationId: org.id,
    action: "gbp.synced",
    targetType: "organization",
    targetId: org.id,
    metadata: { locationCount: orgLocations.length, newReviewCount, reviewsUnavailable, metricsUnavailable, lastError },
  });

  // Only record a result when there was actually something to sync —
  // with 0 locations (e.g. the connect-time API call failed), leave
  // whatever recordGbpSyncResult() already wrote in connectGbp() alone
  // rather than overwriting a real error with a false "success".
  if (orgLocations.length > 0) {
    await recordGbpSyncResult(org.id, metricsUnavailable || reviewsUnavailable ? (lastError?.message ?? null) : null);
  }

  if (newReviewCount > 0) {
    await dispatchWebhookEvent("gbp.reviews_received", { organizationId: org.id, count: newReviewCount });
  }

  await notify({
    organizationId: org.id,
    type: "gbp.synced",
    metadata: { locationCount: orgLocations.length, metricsUnavailable, reviewsUnavailable, errorMessage: lastError?.message },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/gbp");
  revalidatePath("/dashboard/audits");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}

export async function replyToReview(reviewId: string, replyText: string) {
  const locale = await getLocale();
  if (!replyText.trim()) throw new Error(MESSAGES[locale].replyRequired);

  const [review] = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  if (!review) throw new Error(MESSAGES[locale].reviewNotFound);

  const [location] = await db.select().from(locations).where(eq(locations.id, review.locationId)).limit(1);
  if (!location) throw new Error(MESSAGES[locale].locationNotFound);

  const provider = await getGbpProvider(location.organizationId);
  await provider.replyToReview(review.googleReviewId, replyText.trim());

  const [updated] = await db
    .update(reviews)
    .set({ replyText: replyText.trim() })
    .where(eq(reviews.id, reviewId))
    .returning();

  await logAudit({
    organizationId: location.organizationId,
    action: "gbp.review_replied",
    targetType: "review",
    targetId: reviewId,
    metadata: { rating: review.rating },
  });

  await dispatchWebhookEvent("gbp.review_replied", {
    organizationId: location.organizationId,
    reviewId,
    rating: review.rating,
  });

  revalidatePath("/dashboard/gbp");
  return updated;
}
