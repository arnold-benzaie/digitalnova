"use server";

/**
 * MISSION C-2C-2-C — the ONE server action that converts a
 * `discovery_results` row into a real `crm_clients` prospect. Implements
 * the C-2C-2-B design contract exactly — see that mission's own report
 * for the full rationale; this file only restates the load-bearing
 * invariants inline.
 *
 * REUSE, NOT DUPLICATION: requireRadarAccess() [existing RBAC gate],
 * findCrmClientMatch() [Phase A, re-run HERE, never the search-time
 * result], logAudit() [existing audit primitive, used with an explicit
 * `tx` executor — NOT logCrmAudit(), which has no executor parameter and
 * would re-resolve its own session outside this transaction]. This file
 * adds no new dedup rule, no new permission, no new table.
 *
 * TRANSACTIONAL CORE: SELECT ... FOR UPDATE locks the discovery_results
 * row first; every decision (not_found / already_converted / dedup
 * outcome / create) is made from that LOCKED row, inside the same
 * transaction as the INSERT/UPDATE/audit write. A concurrent conversion
 * of the SAME row serializes behind the lock and observes
 * status='converted' on its own turn — never a second INSERT.
 *
 * OPACITY: `already_in_crm` and `ambiguous_match` carry NO field beyond
 * their `status` — never a clientId, name, email, phone, matchedSignals,
 * confidence, or candidateClientIds. requireCrmClientAccess() is never
 * called anywhere in this file: findCrmClientMatch() is deliberately
 * GLOBAL (ignores assigned_user_id), which is exactly what lets an
 * EMPLOYEE'S conversion attempt detect a duplicate they cannot see in the
 * CRM UI, without ever learning anything about it beyond the generic
 * status — the identical property C-2A's own search already relies on.
 *
 * NEVER accepts assignedUserId/organizationId/userId/role from the
 * caller — the acting identity and role come exclusively from
 * requireSession()/requireRadarAccess()'s own resolved values.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, discoveryResults } from "@/db/schema";
import { requireRadarAccess } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { isValidUuid } from "@/lib/api-v1/dto";
import { findCrmClientMatch } from "@/lib/crm-client-dedup";
import { logAudit } from "@/lib/audit";

export type ConvertDiscoveryResultOutcome =
  | { status: "converted"; crmClientId: string }
  | { status: "already_converted"; crmClientId: string }
  /** Deliberately carries NOTHING beyond `status` — see this file's own
   * header. A confirmed CRM duplicate was found; never a clientId, name,
   * or any other CRM-internal field. */
  | { status: "already_in_crm" }
  /** Deliberately carries NOTHING beyond `status` — a Tier-2 signal is
   * never treated as confirmed and never lets the caller see
   * candidateClientIds. */
  | { status: "ambiguous_match" }
  /** Covers BOTH a syntactically invalid id and a genuinely nonexistent
   * row — deliberately indistinguishable, so a forged id can never be
   * used to probe whether a discovery_results row exists (mirrors
   * requireCrmClientAccess()'s own indistinguishable-404 convention). */
  | { status: "not_found" };

/**
 * `discoveryResultId` is `unknown` on purpose — never trusted to already
 * be a valid uuid string merely because it type-checks at the call site.
 */
export async function convertDiscoveryResult(discoveryResultId: unknown): Promise<ConvertDiscoveryResultOutcome> {
  // Authorization is OUTSIDE the try/catch-free path below: requireRadarAccess()
  // signals a denial by THROWING a Next.js redirect, and that throw must
  // propagate untouched — the exact same convention every other
  // RADAR-gated action in this codebase already follows. OWNER/ADMIN/
  // MANAGER/EMPLOYEE-with-radar_access=true pass; CLIENT and any EMPLOYEE
  // with radar_access=false are redirected before this line returns.
  const actorRole = await requireRadarAccess("RADAR_WORK");
  // The acting identity — ALWAYS the resolved session, NEVER accepted
  // from `discoveryResultId` or any other input.
  const { userId } = await requireSession();

  if (typeof discoveryResultId !== "string" || !isValidUuid(discoveryResultId)) {
    return { status: "not_found" };
  }

  return db.transaction(async (tx): Promise<ConvertDiscoveryResultOutcome> => {
    const [row] = await tx
      .select()
      .from(discoveryResults)
      .where(eq(discoveryResults.id, discoveryResultId))
      .for("update")
      .limit(1);

    if (!row) {
      return { status: "not_found" };
    }

    if (row.status === "converted") {
      // discovery_results_converted_link_check guarantees crmClientId is
      // non-null whenever status is "converted" — never re-derived here.
      return { status: "already_converted", crmClientId: row.crmClientId as string };
    }

    // Re-run dedup INSIDE the transaction, under the row lock, on the
    // row's OWN persisted fields — NEVER the search-time dedup result,
    // which is stale the instant a crm_client could have been created in
    // the interim by any other path.
    const crmMatch = await findCrmClientMatch({
      name: row.name,
      email: row.email,
      phone: row.phone,
      city: row.city,
      region: row.region,
      country: row.country,
    });

    if (crmMatch.outcome === "EXACT_MATCH") {
      return { status: "already_in_crm" };
    }
    if (crmMatch.outcome === "AMBIGUOUS_MATCH") {
      return { status: "ambiguous_match" };
    }

    // NO_MATCH: create. Hand-built literal, NEVER a spread of `row` — the
    // same discipline already established by createDiscoveryResult() /
    // processDiscoveryResult() for exactly this reason. category/website/
    // latitude/longitude are DELIBERATELY not mapped (no crm_clients
    // column for the first two per this mission's own contract; no
    // column at all for the last two) — that data stays on the
    // discovery_results row, reachable via crmClientId once linked below.
    // organizationId is left unset (null), matching every existing
    // crm_clients creation path (createClient/createTicket/captureLead) —
    // never invented here.
    const [client] = await tx
      .insert(crmClients)
      .values({
        name: row.name,
        address: row.address,
        country: row.country,
        region: row.region,
        city: row.city,
        phone: row.phone,
        email: row.email,
        postalCode: row.postalCode,
        source: "RADAR Discovery",
        stage: "lead",
        // C-2C-2-B section 6 — resolved from the SERVER-verified role
        // (requireRadarAccess()'s own return value), never from any
        // caller input. OWNER/ADMIN/MANAGER get an unassigned prospect;
        // EMPLOYEE gets it assigned to themselves so it is immediately
        // visible under their own "my prospects" view.
        assignedUserId: actorRole === "EMPLOYEE" ? userId : null,
      })
      .returning();

    await tx
      .update(discoveryResults)
      .set({ status: "converted", crmClientId: client.id })
      .where(eq(discoveryResults.id, discoveryResultId));

    // logAudit() (NOT logCrmAudit(), which has no executor parameter and
    // would re-resolve its own session outside this transaction) —
    // atomic with the two writes above: a rollback of either rolls back
    // the audit entry too.
    await logAudit(
      {
        actorUserId: userId,
        action: "radar.discovery_result_converted",
        targetType: "crm_client",
        targetId: client.id,
        metadata: { discoveryResultId, source: row.source, sourceId: row.sourceId },
      },
      tx,
    );

    return { status: "converted", crmClientId: client.id };
  });
}
