"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { isMarket } from "@/lib/market/context";
import { requireSession } from "@/lib/session";

/**
 * Staff-only: sets/corrects an organization's market — the source of
 * truth `lib/market/context.ts` and every price/currency/region-aware
 * feature reads from. Deliberately unconditional (unlike the
 * approval-time bootstrap in lib/actions/users.ts's approveUser(), which
 * only ever sets a market that's still null) — this IS the controlled
 * admin correction tool Phase 11 of the market mission calls for.
 */
export async function setOrganizationMarketAction(organizationId: string, market: string): Promise<void> {
  const session = await requireSession();
  if (session.role === "client") {
    throw new Error("Réservé au staff.");
  }
  if (!isMarket(market)) {
    throw new Error("Marché invalide.");
  }

  await db.update(organizations).set({ market }).where(eq(organizations.id, organizationId));

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "organization.market_set",
    targetType: "organization",
    targetId: organizationId,
    metadata: { market },
  });

  revalidatePath("/admin/crm/clients/[id]", "page");
}
