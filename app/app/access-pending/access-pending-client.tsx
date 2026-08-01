"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkAccessStatus } from "@/lib/actions/access-status";

const POLL_INTERVAL_MS = 7000;

/**
 * Polls the user's own access state (see lib/actions/access-status.ts)
 * while they wait on this page for admin approval — no page refresh, no
 * sign-out/sign-in, per the reported issue: after an admin approves a
 * pending user, that user was stuck here until they manually reloaded.
 *
 * No Supabase Realtime here: this project has no Realtime channel/RLS
 * wiring anywhere (grepped, confirmed absent) and authenticates via
 * Clerk, not Supabase Auth — Realtime's row-level security model expects
 * Supabase's own JWTs. Polling a Server Action reuses the exact
 * authorization check every other page already relies on
 * (getAccessState() → resolveAccessState(), see lib/session.ts) with no
 * new trust boundary or infrastructure.
 *
 * There is no session/token to refresh on approval: `status` lives in
 * this app's own `users` table, entirely separate from Clerk's session
 * claims. Every protected route already re-reads it fresh from the DB
 * on each request (requireSession() → resolveAccessState()), so once
 * this component detects "active" the only thing needed is a normal
 * client-side navigation — the destination route's own server-side
 * check does the rest, exactly as it already does for a fresh sign-in.
 */
export function AccessPendingClient({ copy }: { copy: { waitingMessage: string; checkingStatus: string; approvedRedirecting: string } }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"waiting" | "checking" | "approved">("waiting");
  const redirectedRef = useRef(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (redirectedRef.current || inFlightRef.current) return;
      inFlightRef.current = true;
      setPhase((p) => (p === "approved" ? p : "checking"));
      try {
        const result = await checkAccessStatus();
        if (cancelled || redirectedRef.current) return;

        if (result.kind === "active") {
          redirectedRef.current = true;
          setPhase("approved");
          router.push(result.role === "client" ? "/dashboard" : "/admin");
          return;
        }
        if (result.kind === "refused") {
          redirectedRef.current = true;
          router.push("/access-refused");
          return;
        }
        if (result.kind === "suspended") {
          redirectedRef.current = true;
          router.push("/access-suspended");
          return;
        }
        if (result.kind === "unauthenticated") {
          redirectedRef.current = true;
          router.push("/sign-in");
          return;
        }
        // Still "pending" — nothing to do, next interval tick retries.
        setPhase("waiting");
      } catch {
        // Network hiccup: never surface a raw error here, just try again
        // on the next tick (see this file's header comment).
        setPhase("waiting");
      } finally {
        inFlightRef.current = false;
      }
    }

    poll(); // Immediate check on mount — an already-approved account (or
    // one refused/suspended in the meantime) shouldn't sit on this page
    // until the first interval fires.
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router]);

  return (
    <p className="mt-2 text-xs text-pm-gris" role="status" aria-live="polite">
      {phase === "approved" ? copy.approvedRedirecting : phase === "checking" ? copy.checkingStatus : copy.waitingMessage}
    </p>
  );
}
