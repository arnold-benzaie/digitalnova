/**
 * RADAR INTELLIGENCE V1 — Slice 1 — pure circuit-breaker state machine.
 *
 * A future failing provider must never slow RADAR. This is the isolation
 * primitive: once a provider trips, the gateway stops calling it until a
 * cooldown elapses, then lets a limited number of probes through.
 *
 * PURE + testable: no timers, no Redis, no I/O, no distributed state. The
 * caller passes `now` (ms epoch); every function returns a NEW snapshot
 * and never mutates its input.
 */

export const CIRCUIT_STATES = ["CLOSED", "OPEN", "HALF_OPEN"] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

export type CircuitBreakerConfig = {
  /** Consecutive failures that trip CLOSED -> OPEN. */
  failureThreshold: number;
  /** ms an OPEN circuit waits before allowing HALF_OPEN probes. */
  cooldownMs: number;
  /** Probes allowed while HALF_OPEN before a decision is forced. */
  halfOpenMaxProbes: number;
};

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = Object.freeze({
  failureThreshold: 3,
  cooldownMs: 30_000,
  halfOpenMaxProbes: 1,
});

export type CircuitBreakerSnapshot = {
  state: CircuitState;
  consecutiveFailures: number;
  /** ms epoch the circuit last opened; null while CLOSED. */
  openedAt: number | null;
  /** probes issued since entering HALF_OPEN. */
  halfOpenProbes: number;
};

export function initCircuit(): CircuitBreakerSnapshot {
  return { state: "CLOSED", consecutiveFailures: 0, openedAt: null, halfOpenProbes: 0 };
}

/**
 * Would the gateway be allowed to call the provider right now? Pure read —
 * it does NOT transition state (call `beginProbe` to record a HALF_OPEN
 * attempt). An OPEN circuit whose cooldown has elapsed is treated as
 * probe-eligible (the machine moves to HALF_OPEN on the next `beginProbe`).
 */
export function canAttempt(
  snap: CircuitBreakerSnapshot,
  now: number,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG,
): boolean {
  if (snap.state === "CLOSED") return true;
  if (snap.state === "HALF_OPEN") return snap.halfOpenProbes < config.halfOpenMaxProbes;
  // OPEN
  if (snap.openedAt === null) return false;
  return now - snap.openedAt >= config.cooldownMs;
}

/** Record that a probe is being issued now — moves OPEN(cooled) -> HALF_OPEN
 * and increments the probe counter. No-op semantics for CLOSED. */
export function beginProbe(
  snap: CircuitBreakerSnapshot,
  now: number,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG,
): CircuitBreakerSnapshot {
  if (snap.state === "CLOSED") return { ...snap };
  if (snap.state === "OPEN") {
    if (snap.openedAt !== null && now - snap.openedAt >= config.cooldownMs) {
      return { ...snap, state: "HALF_OPEN", halfOpenProbes: 1 };
    }
    return { ...snap };
  }
  // HALF_OPEN
  return { ...snap, halfOpenProbes: snap.halfOpenProbes + 1 };
}

/** A provider call succeeded: reset to CLOSED regardless of prior state. */
export function recordSuccess(): CircuitBreakerSnapshot {
  return { state: "CLOSED", consecutiveFailures: 0, openedAt: null, halfOpenProbes: 0 };
}

/** A provider call failed: increment failures; trip to OPEN from CLOSED at
 * the threshold, or immediately re-OPEN from HALF_OPEN. */
export function recordFailure(
  snap: CircuitBreakerSnapshot,
  now: number,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG,
): CircuitBreakerSnapshot {
  const consecutiveFailures = snap.consecutiveFailures + 1;
  if (snap.state === "HALF_OPEN") {
    return { state: "OPEN", consecutiveFailures, openedAt: now, halfOpenProbes: 0 };
  }
  if (consecutiveFailures >= config.failureThreshold) {
    return { state: "OPEN", consecutiveFailures, openedAt: now, halfOpenProbes: 0 };
  }
  return { ...snap, consecutiveFailures };
}
