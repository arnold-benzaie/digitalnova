"use client";

import { useState } from "react";
import { isValidPhoneNumber, type Country } from "react-phone-number-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChatPhoneInput } from "@/components/chat/chat-phone-input";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { REQUEST_TYPE_KEYS, type RequestTypeKey } from "@/lib/chat/request-type-catalog";

// §Phase 1F — a country-level "market" only ever maps to a default
// country when it names exactly ONE country (Canada). "EUROPE" spans
// dozens of countries and is deliberately never turned into a guessed
// one — never invent the user's country, per the explicit requirement.
function marketToCountry(market: "CANADA" | "EUROPE" | null): Country | undefined {
  return market === "CANADA" ? "CA" : undefined;
}

// Browser-locale fallback (e.g. "fr-CA" -> "CA", "en-US" -> "US") — a
// per-visitor signal, used only when there's no more reliable
// market-based hint. Never throws: `Intl` region parsing on a locale
// with no region subtag (e.g. plain "fr") just yields undefined here,
// same as no hint at all.
function localeToCountry(): Country | undefined {
  if (typeof navigator === "undefined") return undefined;
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region as Country | undefined;
  } catch {
    return undefined;
  }
}

export type ChatLeadFormValues = {
  fullName: string;
  email: string;
  phone?: string;
  company?: string;
  country?: string;
  requestType: RequestTypeKey;
  preferredDate?: string;
  preferredTimeSlot?: string;
  message: string;
};

export function ChatLeadForm({
  locale,
  market,
  submitting,
  errorMessage,
  onSubmit,
  onCancel,
}: {
  locale: Locale;
  market: "CANADA" | "EUROPE" | null;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: ChatLeadFormValues) => void;
  onCancel: () => void;
}) {
  const t = dictionaries[locale].chat.leadForm;
  // Computed once at mount — "intelligent default, never inventing, never
  // blocking": the phone selector always stays fully changeable
  // afterward regardless of where this initial guess came from.
  const [defaultCountry] = useState<Country | undefined>(() => marketToCountry(market) ?? localeToCountry());
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [country, setCountry] = useState("");
  const [requestType, setRequestType] = useState<RequestTypeKey | "">("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTimeSlot, setPreferredTimeSlot] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!fullName.trim() || !email.trim() || !requestType || !message.trim()) {
      setValidationError(t.requiredError);
      return;
    }
    // Empty stays valid and accepted (§1 — never required); only a
    // NON-empty, syntactically invalid number blocks submission. `phone`
    // is already E.164 (the ChatPhoneInput below only ever produces that
    // format or ""), so this re-validates with the same library the
    // server will use, never a hand-rolled check.
    if (phone.trim() && !isValidPhoneNumber(phone.trim())) {
      setValidationError(t.phoneInvalidError);
      return;
    }
    if (!consent) {
      setValidationError(t.consentRequiredError);
      return;
    }
    setValidationError(null);
    onSubmit({
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      company: company.trim() || undefined,
      country: country.trim() || undefined,
      requestType,
      preferredDate: preferredDate.trim() || undefined,
      preferredTimeSlot: preferredTimeSlot.trim() || undefined,
      message: message.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-xl border border-pm-gris-2 bg-pm-blanc p-3">
      <p className="text-sm font-medium text-pm-noir">{t.title}</p>

      <label className="flex flex-col gap-1 text-xs text-pm-gris">
        {t.fullName}
        <Input value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={150} disabled={submitting} />
      </label>

      <label className="flex flex-col gap-1 text-xs text-pm-gris">
        {t.email}
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={200} disabled={submitting} />
      </label>

      <label className="flex flex-col gap-1 text-xs text-pm-gris">
        {t.phone}
        <ChatPhoneInput
          value={phone}
          onChange={setPhone}
          defaultCountry={defaultCountry}
          locale={locale}
          ariaLabel={t.phone}
          countrySelectAriaLabel={t.phoneCountryAriaLabel}
          countrySearchPlaceholder={t.phoneCountrySearchPlaceholder}
          placeholder=""
          disabled={submitting}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-pm-gris">
        {t.company}
        <Input value={company} onChange={(event) => setCompany(event.target.value)} maxLength={150} disabled={submitting} />
      </label>

      <label className="flex flex-col gap-1 text-xs text-pm-gris">
        {t.country}
        <Input value={country} onChange={(event) => setCountry(event.target.value)} maxLength={100} disabled={submitting} />
      </label>

      <label className="flex flex-col gap-1 text-xs text-pm-gris">
        {t.requestType}
        <select
          value={requestType}
          onChange={(event) => setRequestType(event.target.value as RequestTypeKey)}
          required
          disabled={submitting}
          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm text-pm-noir shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="" disabled>
            —
          </option>
          {REQUEST_TYPE_KEYS.map((key) => (
            <option key={key} value={key}>
              {t.requestTypeOptions[key]}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs text-pm-gris">
          {t.preferredDate}
          <Input type="date" value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} disabled={submitting} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-pm-gris">
          {t.preferredTime}
          <Input value={preferredTimeSlot} onChange={(event) => setPreferredTimeSlot(event.target.value)} maxLength={100} disabled={submitting} />
        </label>
      </div>
      {(preferredDate || preferredTimeSlot) && <p className="text-[11px] text-pm-gris italic">{t.preferredNote}</p>}

      <label className="flex flex-col gap-1 text-xs text-pm-gris">
        {t.message}
        <Textarea value={message} onChange={(event) => setMessage(event.target.value)} required maxLength={2000} rows={3} disabled={submitting} />
      </label>

      <label className="flex items-start gap-2 text-xs text-pm-gris">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" disabled={submitting} />
        {t.consentLabel}
      </label>

      {(validationError || errorMessage) && <p className="text-xs text-pm-rouge">{validationError ?? errorMessage}</p>}

      <div className="mt-1 flex gap-2">
        <Button type="submit" size="sm" disabled={submitting} className="bg-pm-noir hover:bg-pm-noir/90">
          {t.submit}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}
