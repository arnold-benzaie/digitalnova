"use server";

import { and, eq, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizations, searchConsoleMetrics, searchConsoleProperties } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getGoogleConnection, recordSearchConsoleSyncResult, sanitizeGoogleError } from "@/lib/google/oauth";
import { notify } from "@/lib/notifications";
import { getSearchConsoleProvider, type SearchConsoleProperty } from "@/lib/searchconsole";
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

export async function connectSearchConsole(organizationId?: string) {
  const locale = await getLocale();
  const org = await resolveOrganization(organizationId, locale);

  const googleConnection = await getGoogleConnection(org.id);
  if (!googleConnection) {
    throw new Error(MESSAGES[locale].noGoogleConnection);
  }

  const provider = getSearchConsoleProvider(org.id);

  let remoteProperties: SearchConsoleProperty[] = [];
  let propertiesError: ReturnType<typeof sanitizeGoogleError> | undefined;
  try {
    remoteProperties = await provider.listProperties();
  } catch (err) {
    propertiesError = sanitizeGoogleError(err);
  }

  for (const property of remoteProperties) {
    await db
      .insert(searchConsoleProperties)
      .values({ organizationId: org.id, siteUrl: property.siteUrl, permissionLevel: property.permissionLevel })
      .onConflictDoUpdate({
        target: [searchConsoleProperties.organizationId, searchConsoleProperties.siteUrl],
        set: { permissionLevel: property.permissionLevel },
      });
  }

  // Same authoritative-replace rule as GBP: only prune stale properties on
  // a successful fetch, never on error.
  if (!propertiesError) {
    const currentUrls = remoteProperties.map((p) => p.siteUrl);
    await db.delete(searchConsoleProperties).where(
      currentUrls.length > 0
        ? and(eq(searchConsoleProperties.organizationId, org.id), notInArray(searchConsoleProperties.siteUrl, currentUrls))
        : eq(searchConsoleProperties.organizationId, org.id),
    );
  }

  if (propertiesError) {
    await logAudit({
      organizationId: org.id,
      action: "search_console.connect_error",
      targetType: "organization",
      targetId: org.id,
      metadata: propertiesError,
    });
  }

  // See lib/actions/gbp.ts::connectGbp for why this runs before
  // syncSearchConsoleData() below: with 0 properties, that call leaves
  // this result untouched instead of overwriting it with a false "success".
  await recordSearchConsoleSyncResult(org.id, propertiesError ? propertiesError.message : null);

  await logAudit({
    organizationId: org.id,
    action: "search_console.connected",
    targetType: "organization",
    targetId: org.id,
    metadata: { propertyCount: remoteProperties.length },
  });

  await dispatchWebhookEvent("search_console.connected", { organizationId: org.id, propertyCount: remoteProperties.length });

  await syncSearchConsoleData(org.id);
}

export async function syncSearchConsoleData(organizationId?: string) {
  const locale = await getLocale();
  const org = await resolveOrganization(organizationId, locale);
  const provider = getSearchConsoleProvider(org.id);

  const orgProperties = await db.select().from(searchConsoleProperties).where(eq(searchConsoleProperties.organizationId, org.id));

  let metricsUnavailable = false;
  let lastError: ReturnType<typeof sanitizeGoogleError> | undefined;

  for (const property of orgProperties) {
    try {
      const metrics = await provider.getPerformance(property.siteUrl, 30);
      for (const day of metrics) {
        const ctrBasisPoints = Math.round(day.ctr * 10000);
        const averagePositionCentiles = Math.round(day.position * 100);
        await db
          .insert(searchConsoleMetrics)
          .values({
            propertyId: property.id,
            date: new Date(day.date),
            clicks: day.clicks,
            impressions: day.impressions,
            ctrBasisPoints,
            averagePositionCentiles,
          })
          .onConflictDoUpdate({
            target: [searchConsoleMetrics.propertyId, searchConsoleMetrics.date],
            set: { clicks: day.clicks, impressions: day.impressions, ctrBasisPoints, averagePositionCentiles },
          });
      }
    } catch (err) {
      metricsUnavailable = true;
      lastError = sanitizeGoogleError(err);
    }
  }

  await logAudit({
    organizationId: org.id,
    action: "search_console.synced",
    targetType: "organization",
    targetId: org.id,
    metadata: { propertyCount: orgProperties.length, metricsUnavailable, lastError },
  });

  if (orgProperties.length > 0) {
    await recordSearchConsoleSyncResult(org.id, metricsUnavailable ? (lastError?.message ?? null) : null);
  }

  await notify({
    organizationId: org.id,
    type: "search_console.synced",
    metadata: { propertyCount: orgProperties.length, metricsUnavailable, errorMessage: lastError?.message },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/search-console");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}
