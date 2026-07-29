"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/gbp-audit/ui/button";
import { Field, Input, Textarea } from "@/components/gbp-audit/ui/field";
import { verifyWebhookSignatureAction, type SignatureVerificationResult } from "@/lib/developer-console/dev-tools";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

/** Recomputes the expected signature server-side (via the real
 * signWebhookBody) and compares it to what the developer pasted — never
 * duplicates the HMAC logic client-side. */
export function SignatureVerifier({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.webhookTools.verifyCard;
  const [secret, setSecret] = useState("");
  const [timestamp, setTimestamp] = useState("");
  const [body, setBody] = useState("");
  const [signature, setSignature] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignatureVerificationResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("secret", secret);
    formData.set("timestamp", timestamp);
    formData.set("body", body);
    formData.set("signature", signature);

    startTransition(async () => {
      try {
        const outcome = await verifyWebhookSignatureAction(formData);
        setResult(outcome);
      } catch (err) {
        setResult(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6">
      <div>
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>
        <p className="mt-1 text-sm text-pm-gris">{t.body}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label={t.secretLabel} htmlFor="sig-verify-secret" required>
          <Input id="sig-verify-secret" type="text" required className="font-mono" value={secret} onChange={(event) => setSecret(event.target.value)} />
        </Field>
        <Field label={t.timestampLabel} htmlFor="sig-verify-timestamp" required>
          <Input id="sig-verify-timestamp" type="text" required className="font-mono" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} />
        </Field>
        <Field label={t.bodyLabel} htmlFor="sig-verify-body" required>
          <Textarea id="sig-verify-body" required rows={4} className="font-mono text-xs" value={body} onChange={(event) => setBody(event.target.value)} />
        </Field>
        <Field label={t.signatureLabel} htmlFor="sig-verify-signature" required>
          <Input id="sig-verify-signature" type="text" required className="font-mono" value={signature} onChange={(event) => setSignature(event.target.value)} />
        </Field>
        {error && (
          <p className="text-sm text-pm-rouge" role="alert">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" size="sm" loading={isPending}>
            {t.submit}
          </Button>
        </div>
      </form>

      {result && (
        <div className={`flex flex-col gap-2 rounded-lg border p-4 text-sm ${result.valid ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-pm-rouge/30 bg-pm-rouge/5 text-pm-rouge-2"}`}>
          <p className="font-semibold">{result.valid ? t.resultValid : t.resultInvalid}</p>
          {!result.valid && (
            <p className="font-mono text-xs opacity-80">
              {t.expectedSignature}: {result.expectedSignature}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
