/**
 * RADAR INTELLIGENCE PLATFORM V1 — Slice 1 — public surface.
 *
 * Provider-agnostic foundation ONLY. No external provider is connected; the
 * deterministic RADAR core stays authoritative and RADAR is fully
 * functional with zero providers. Anything here is advisory-only and never
 * decides authorization, assignment, score, or queue order.
 */
export * from "./types";
export * from "./errors";
export * from "./policy";
export * from "./circuit-breaker";
export * from "./sanitize-context";
export * from "./provider-registry";
export * from "./deterministic-fallback";
export * from "./gateway";
export * from "./integration-domains";
export * from "./telemetry";
export * from "./snapshot";
export * from "./adapters";
// NOTE: ./get-radar-intelligence is intentionally NOT re-exported here — it
// pulls in the RBAC/DB chain (requireStaffMember). Import it directly from
// server code that needs it.
