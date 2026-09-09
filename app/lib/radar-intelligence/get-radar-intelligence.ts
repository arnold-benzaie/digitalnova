/**
 * RADAR INTELLIGENCE V1 — Slice 2 — internal opt-in service entry point.
 *
 * Server-side ONLY. NOT a `"use server"` action and NOT a public API route
 * — a plain service function future server code can call. It is NOT wired
 * into the /admin/crm/radar render path; nothing runs it automatically.
 *
 * Authorization: requireStaffMember("RADAR_QUEUE_VIEW") — the exact
 * capability the existing RADAR queue read already requires (OWNER / ADMIN
 * / MANAGER / EMPLOYEE). No new RBAC permission, no permissions.ts change.
 *
 * Identity/scope: this function accepts an ALREADY-BUILT deterministic
 * prospect representation (the caller obtained it through the existing,
 * authorized RADAR read path). It takes NO userId / workspace / employee /
 * email argument — nothing a caller passes selects another identity.
 *
 * Provider: DISABLED BY DEFAULT. With the default config there is no
 * external provider, so the result is identical to Slice 1
 * (providerUnavailable: true, source: "radar-core", intelligence: null).
 * A future slice supplies an enabled config + a real transport.
 */
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { createRadarIntelligenceGateway } from "./gateway";
import { buildRadarIntelligenceSnapshot, type RadarIntelligenceSnapshotInput } from "./snapshot";
import type { RadarIntelligenceSnapshot } from "./types";
import { createRadarIntelligenceRegistry, type CreateRegistryOptions } from "./adapters";

export type GetRadarIntelligenceDeps = {
  /** Test/wiring seam. Omitted in every production call today -> the
   * disabled-by-default registry (deterministic fallback only) is used. */
  registryOptions?: CreateRegistryOptions;
  clock?: () => Date;
  generateRequestId?: () => string;
};

export async function getRadarIntelligenceForProspect(
  input: RadarIntelligenceSnapshotInput,
  deps: GetRadarIntelligenceDeps = {},
): Promise<RadarIntelligenceSnapshot> {
  await requireStaffMember("RADAR_QUEUE_VIEW");

  const registry = createRadarIntelligenceRegistry(deps.registryOptions ?? {});
  const gateway = createRadarIntelligenceGateway({
    registry,
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.generateRequestId ? { generateRequestId: deps.generateRequestId } : {}),
  });

  return buildRadarIntelligenceSnapshot(input, { gateway });
}
