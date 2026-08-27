"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { respondToQuoteByToken, type QuoteResponseFailureReason } from "@/lib/actions/crm-quote-response";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

/**
 * Chantier 1 / Phase 4 — the only interactive island on this otherwise
 * read-only public page. Kept separate from PublicQuoteDocument (a Server
 * Component) so that document stays a pure, non-"use client" render.
 *
 * token is already public (it's in the page's own URL) — passing it as a
 * prop exposes nothing new. status is the value already resolved
 * server-side for this render; buttons only ever show for "sent" so an
 * already-responded/expired/draft load renders nothing here, matching the
 * status already visible in the document's own status field above.
 */
export function QuoteResponseActions({ token, status, locale }: { token: string; status: string; locale: Locale }) {
  const t = dictionaries[locale].quoteVerification.response;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ kind: "success"; message: string } | { kind: "error"; message: string } | null>(null);

  if (result?.kind !== "success" && status !== "sent") {
    return null;
  }

  function respond(decision: "accepted" | "declined") {
    if (decision === "declined" && !window.confirm(t.confirmDecline)) return;
    startTransition(async () => {
      const response = await respondToQuoteByToken(token, decision);
      if (response.ok) {
        setResult({ kind: "success", message: decision === "accepted" ? t.accepted : t.declined });
        router.refresh();
      } else {
        setResult({ kind: "error", message: errorMessage(t, response.reason) });
      }
    });
  }

  if (result?.kind === "success") {
    return (
      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white px-5 py-6 text-center shadow-[0_12px_32px_rgba(8,8,8,0.07)] sm:px-8">
        <p role="status" className="text-sm font-semibold text-pm-noir">
          {result.message}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white px-5 py-6 shadow-[0_12px_32px_rgba(8,8,8,0.07)] sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={isPending}
          onClick={() => respond("accepted")}
          className="w-full rounded-lg bg-pm-noir px-5 py-3 text-sm font-semibold text-white transition disabled:opacity-50 sm:w-auto"
        >
          {isPending ? t.sending : t.accept}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => respond("declined")}
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-5 py-3 text-sm font-semibold text-pm-noir transition disabled:opacity-50 sm:w-auto"
        >
          {isPending ? t.sending : t.decline}
        </button>
      </div>
      {result?.kind === "error" && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {result.message}
        </p>
      )}
    </div>
  );
}

function errorMessage(t: (typeof dictionaries)[Locale]["quoteVerification"]["response"], reason: QuoteResponseFailureReason): string {
  if (reason === "conflicting_decision") return t.conflictingDecision;
  if (reason === "not_eligible") return t.notEligible;
  return t.genericError;
}
