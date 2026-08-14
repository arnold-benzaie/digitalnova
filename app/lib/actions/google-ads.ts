"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { clearGoogleAdsAccountSelection, selectGoogleAdsAccount } from "@/lib/google-ads/accounts";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { disconnectGoogleAds } from "@/lib/google-ads/tokens";
import { requireSession } from "@/lib/session";

/**
 * Client-only, same as the connect/callback routes — a client can only
 * ever disconnect THEIR OWN organization's Google Ads connection, scoped
 * exclusively from the authenticated session. Does not delete the
 * PUBLIC-MAP account, does not touch any other Google integration
 * (GBP/Analytics/SearchConsole live in a completely separate table).
 */
export async function disconnectGoogleAdsAction(): Promise<{ success: boolean }> {
  const session = await requireSession();
  if (session.role !== "client") {
    throw new Error("Réservé aux clients.");
  }

  const result = await disconnectGoogleAds(session.organizationId);

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "google_ads.disconnected",
    targetType: "organization",
    targetId: session.organizationId,
    metadata: { revokedWithGoogle: result.revoked, existed: result.existed },
  });

  revalidatePath("/dashboard/google-ads");
  return { success: true };
}

/**
 * Client-only. `customerId` comes from the browser (the account the
 * client clicked in the selection list) but is NEVER trusted on its own —
 * selectGoogleAdsAccount() re-verifies it against a fresh discovery call
 * using the connection's own OAuth token before persisting anything. A
 * malicious/stale customerId the token genuinely can't reach is rejected,
 * never silently stored.
 */
export async function selectGoogleAdsAccountAction(customerId: string): Promise<{ success: boolean }> {
  const session = await requireSession();
  if (session.role !== "client") {
    throw new Error("Réservé aux clients.");
  }
  if (typeof customerId !== "string" || !/^\d+$/.test(customerId)) {
    throw new Error("Identifiant de compte invalide.");
  }

  try {
    const account = await selectGoogleAdsAccount(session.organizationId, customerId);
    await logAudit({
      actorUserId: session.userId,
      organizationId: session.organizationId,
      action: "google_ads.account_selected",
      targetType: "organization",
      targetId: session.organizationId,
      metadata: { customerId: account.customerId },
    });
  } catch (err) {
    await logAudit({
      actorUserId: session.userId,
      organizationId: session.organizationId,
      action: "google_ads.account_selection_error",
      targetType: "organization",
      targetId: session.organizationId,
      metadata: sanitizeGoogleAdsError(err),
    });
    throw new Error("Impossible de sélectionner ce compte — reconnectez-vous ou réessayez.");
  }

  revalidatePath("/dashboard/google-ads");
  return { success: true };
}

/** "Changer de compte" — keeps the OAuth grant, only clears the selected
 * customerId so the client sees the selection step again. */
export async function clearGoogleAdsAccountSelectionAction(): Promise<{ success: boolean }> {
  const session = await requireSession();
  if (session.role !== "client") {
    throw new Error("Réservé aux clients.");
  }
  await clearGoogleAdsAccountSelection(session.organizationId);
  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "google_ads.account_selection_cleared",
    targetType: "organization",
    targetId: session.organizationId,
  });
  revalidatePath("/dashboard/google-ads");
  return { success: true };
}
