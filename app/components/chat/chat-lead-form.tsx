"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export type ChatLeadFormValues = {
  fullName: string;
  email: string;
  phone?: string;
  company?: string;
  country?: string;
  message: string;
};

export function ChatLeadForm({
  locale,
  submitting,
  errorMessage,
  onSubmit,
  onCancel,
}: {
  locale: Locale;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: ChatLeadFormValues) => void;
  onCancel: () => void;
}) {
  const t = dictionaries[locale].chat.leadForm;
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [country, setCountry] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!fullName.trim() || !email.trim() || !message.trim()) {
      setValidationError(t.requiredError);
      return;
    }
    if (!consent) {
      setValidationError(t.consentRequiredError);
      return;
    }
    setValidationError(null);
    onSubmit({ fullName: fullName.trim(), email: email.trim(), phone: phone.trim() || undefined, company: company.trim() || undefined, country: country.trim() || undefined, message: message.trim() });
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
        <Input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={50} disabled={submitting} />
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
