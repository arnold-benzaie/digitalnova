"use client";

import { useState, useTransition } from "react";
import { submitPortalQuoteRequest } from "@/lib/actions/gbp-audit-portal";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function QuoteRequestForm({ token, offers, locale = "fr" }: { token: string; offers: { id: string; label: string }[]; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.quotes.form;
  const [message, setMessage] = useState("");
  const [serviceOfferId, setServiceOfferId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
        {t.submitted}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>
      <p className="mt-1 text-sm text-pm-gris">{t.lead}</p>
      {offers.length > 0 && (
        <label className="mt-3 flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
          {t.offerLabel}
          <select
            value={serviceOfferId}
            onChange={(e) => setServiceOfferId(e.target.value)}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
          >
            <option value="">{t.noOffer}</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        className="mt-3 w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        placeholder={t.messagePlaceholder}
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await submitPortalQuoteRequest(token, serviceOfferId || null, message, locale);
              setDone(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : t.error);
            }
          })
        }
        className="mt-3 rounded-lg bg-pm-noir px-5 py-2.5 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? t.sending : t.submit}
      </button>
      {error && <p className="mt-2 text-sm text-pm-rouge">{error}</p>}
    </div>
  );
}
