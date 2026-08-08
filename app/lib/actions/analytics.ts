"use server";

import { and, eq, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { analyticsMetrics, analyticsProperties, organizations } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getAnalyticsProvider, type AnalyticsProperty } from "@/lib/analytics";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getGoogleConnection, recordAnalyticsSyncResult, sanitizeGoogleError } from "@/lib/google/oauth";
import { notify } from "@/lib/notifications";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const MESSAGES = {
  fr: {
    organizationNotFound: "Organisation introuvable.",
    noGoogleConnection: "Aucun compte Google connecté pour cette organisation. Utilisez le bouton « Connecter un compte Google ».",
  },
  en: {
    organizationNotFound: "Organization not found.",
    noGoogleConnection: "No Google account connected for this organization. Use the \"Connect a Google account\" button.",
  },
} as const;

/** Same pattern as lib/actions/gbp.ts::resolveOrganization. */
async function resolveOrganization(organizationId: string | undefined, locale: Locale) {
  if (!organizationId) return getOrCreateDevOrganization();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new Error(MESSAGES[locale].organizationNotFound);
  return org;
}

export async function connectAnalytics(organizationId?: string) {
  const locale = await getLocale();
  const org = await resolveOrganization(organizationId, locale);

  const googleConnection = await getGoogleConnection(org.id);
  if (!googleConnection) {
    throw new Error(MESSAGES[locale].noGoogleConnection);
  }

  const provider = getAnalyticsProvider(org.id);

  let remoteProperties: AnalyticsProperty[] = [];
  let propertiesError: ReturnType<typeof sanitizeGoogleError> | undefined;
  try {
    remoteProperties = await provider.listProperties();
  } catch (err) {
    propertiesError = sanitizeGoogleError(err);
  }

  for (const property of remoteProperties) {
    await db
      .insert(analyticsProperties)
      .values({ organizationId: org.id, propertyResourceName: property.propertyResourceName, displayName: property.displayName })
      .onConflictDoUpdate({
        target: [analyticsProperties.organizationId, analyticsProperties.propertyResourceName],
        set: { displayName: property.displayName },
      });
  }

  if (!propertiesError) {
    const currentNames = remoteProperties.map((p) => p.propertyResourceName);
    await db.delete(analyticsProperties).where(
      currentNames.length > 0
        ? and(eq(analyticsProperties.organizationId, org.id), notInArray(analyticsProperties.propertyResourceName, currentNames))
        : eq(analyticsProperties.organizationId, org.id),
    );
  }

  if (propertiesError) {
    await logAudit({
      organizationId: org.id,
      action: "analytics.connect_error",
      targetType: "organization",
      targetId: org.id,
      metadata: propertiesError,
    });
  }

  // See lib/actions/gbp.ts::connectGbp for why this runs before
  // syncAnalyticsData() below: with 0 properties, that call leaves this
  // result untouched instead of overwriting it with a false "success".
  await recordAnalyticsSyncResult(org.id, propertiesError ? propertiesError.message : null);

  await logAudit({
    organizationId: org.id,
    action: "analytics.connected",
    targetType: "organization",
    targetId: org.id,
    metadata: { propertyCount: remoteProperties.length },
  });

  await dispatchWebhookEvent("analytics.connected", { organizationId: org.id, propertyCount: remoteProperties.length });

  await syncAnalyticsData(org.id);
}

export async function syncAnalyticsData(organizationId?: string) {
  const locale = await getLocale();
  const org = await resolveOrganization(organizationId, locale);
  const provider = getAnalyticsProvider(org.id);

  const orgProperties = await db.select().from(analyticsProperties).where(eq(analyticsProperties.organizationId, org.id));

  let metricsUnavailable = false;
  let lastError: ReturnType<typeof sanitizeGoogleError> | undefined;

  for (const property of orgProperties) {
    try {
      const metrics = await provider.getMetrics(property.propertyResourceName, 30);
      for (const day of metrics) {
        const bounceRateBasisPoints = Math.round(day.bounceRate * 10000);
        await db
          .insert(analyticsMetrics)
          .values({
            propertyId: property.id,
            date: new Date(day.date),
            sessions: day.sessions,
            activeUsers: day.activeUsers,
            pageviews: day.pageviews,
            bounceRateBasisPoints,
          })
          .onConflictDoUpdate({
            target: [analyticsMetrics.propertyId, analyticsMetrics.date],
            set: { sessions: day.sessions, activeUsers: day.activeUsers, pageviews: day.pageviews, bounceRateBasisPoints },
          });
      }
    } catch (err) {
      metricsUnavailable = true;
      lastError = sanitizeGoogleError(err);
    }
  }

  await logAudit({
    organizationId: org.id,
    action: "analytics.synced",
    targetType: "organization",
    targetId: org.id,
    metadata: { propertyCount: orgProperties.length, metricsUnavailable, lastError },
  });

  if (orgProperties.length > 0) {
    await recordAnalyticsSyncResult(org.id, metricsUnavailable ? (lastError?.message ?? null) : null);
  }

  await notify({
    organizationId: org.id,
    type: "analytics.synced",
    metadata: { propertyCount: orgProperties.length, metricsUnavailable, errorMessage: lastError?.message },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/analytics");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}
