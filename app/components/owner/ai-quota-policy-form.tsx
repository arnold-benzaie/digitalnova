"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { updateRadarAiQuotaPolicy } from "@/lib/actions/radar-ai-quota-policy";
import type { RadarAiQuotaPolicy } from "@/lib/radar-intelligence/quota-policy-store";
import { Field, Input } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G4A — the OWNER-only AI Quota Policy
 * form, embedded in the existing /admin/owner/ai-governance page's
 * "Quotas et limites" section (no new page).
 *
 * PRESENTATION + client-side pre-validation only, mirroring
 * ai-provider-policy-form.tsx's own philosophy: every mutation goes
 * through the requireStaffMember("RADAR_AI_POLICY_MANAGE")-gated
 * updateRadarAiQuotaPolicy() Server Action, which re-validates with the
 * exact same authoritative rule (validateQuotaPolicyCandidate) regardless
 * of what this component already checked client-side.
 *
 * G4A SCOPE: this form edits CONFIGURATION only. It never displays a
 * computed consumption, a "remaining budget," or a "limited" operational
 * state — that live, durable state (G4B-2 enforcement is active in
 * Production) is rendered by the separate "Quota actuel" section on the
 * same page (components/owner/ai-quota-status-panel.tsx, Phase G4C-3),
 * fed by getRadarAiQuotaGovernanceSnapshot() — never recomputed here.
 */

export type QuotaPolicyFormDict = {
  enforcementNotice: string;
  enabledLabel: string;
  dailyRequestLimitLabel: string;
  dailyRequestLimitHint: string;
  dailyTokenLimitLabel: string;
  dailyTokenLimitHint: string;
  warningThresholdLabel: string;
  warningThresholdHint: string;
  saveButtonLabel: string;
  savedMessage: string;
  validationErrorMessage: string;
};

export type QuotaPolicyFormProps = {
  initialPolicy: RadarAiQuotaPolicy;
  t: QuotaPolicyFormDict;
};

/** "" (empty input) <-> null (no limit configured) — never confused with
 * "0" (a real, literal zero-limit value: "block everything"). */
export function limitToInputValue(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * Returns a validated non-negative integer, `null` for an empty field (no
 * limit), or the literal string "invalid" for anything else — never
 * silently coerced, rounded, or clamped. Client-side pre-check only; the
 * Server Action re-validates with the exact same rule regardless of what
 * this function decides.
 */
export function parseLimitInput(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : "invalid";
}

/** Same non-coercion discipline as parseLimitInput, bounded to 0-100 and
 * never nullable (there is no "no threshold configured" state). */
export function parseThresholdInput(raw: string): number | "invalid" {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : "invalid";
}

export function QuotaPolicyForm({ initialPolicy, t }: QuotaPolicyFormProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialPolicy.enabled);
  const [dailyRequestLimitRaw, setDailyRequestLimitRaw] = useState(limitToInputValue(initialPolicy.dailyRequestLimit));
  const [dailyTokenLimitRaw, setDailyTokenLimitRaw] = useState(limitToInputValue(initialPolicy.dailyTokenLimit));
  const [warningThresholdRaw, setWarningThresholdRaw] = useState(String(initialPolicy.warningThresholdPercent));
  const [hasError, setHasError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasError(false);
    setSaved(false);

    const dailyRequestLimit = parseLimitInput(dailyRequestLimitRaw);
    const dailyTokenLimit = parseLimitInput(dailyTokenLimitRaw);
    const warningThresholdPercent = parseThresholdInput(warningThresholdRaw);

    if (dailyRequestLimit === "invalid" || dailyTokenLimit === "invalid" || warningThresholdPercent === "invalid") {
      setHasError(true);
      return;
    }

    startTransition(async () => {
      try {
        await updateRadarAiQuotaPolicy({ enabled, dailyRequestLimit, dailyTokenLimit, warningThresholdPercent });
        setSaved(true);
        router.refresh();
      } catch {
        // The Server Action's own thrown message is a safe, already-crafted
        // validation string (never a raw DB error) -- but this component
        // deliberately shows only the fixed, translated notice below rather
        // than the raw thrown text, so no future change to that message's
        // wording can leak anything unexpected here.
        setHasError(true);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-xs text-pm-gris">{t.enforcementNotice}</p>

      <label className="flex items-center gap-2 text-sm text-pm-noir">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 rounded border-pm-gris-2" />
        {t.enabledLabel}
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t.dailyRequestLimitLabel} hint={t.dailyRequestLimitHint} htmlFor="quota-daily-request-limit">
          <Input
            id="quota-daily-request-limit"
            inputMode="numeric"
            value={dailyRequestLimitRaw}
            onChange={(event) => setDailyRequestLimitRaw(event.target.value)}
            hasError={hasError}
          />
        </Field>
        <Field label={t.dailyTokenLimitLabel} hint={t.dailyTokenLimitHint} htmlFor="quota-daily-token-limit">
          <Input
            id="quota-daily-token-limit"
            inputMode="numeric"
            value={dailyTokenLimitRaw}
            onChange={(event) => setDailyTokenLimitRaw(event.target.value)}
            hasError={hasError}
          />
        </Field>
      </div>

      <Field label={t.warningThresholdLabel} hint={t.warningThresholdHint} htmlFor="quota-warning-threshold">
        <Input
          id="quota-warning-threshold"
          inputMode="numeric"
          value={warningThresholdRaw}
          onChange={(event) => setWarningThresholdRaw(event.target.value)}
          hasError={hasError}
        />
      </Field>

      {hasError && (
        <p className="text-[11px] font-medium text-pm-rouge" role="alert">
          {t.validationErrorMessage}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={isPending}>
          {t.saveButtonLabel}
        </Button>
        {saved && !hasError && <span className="text-xs text-pm-gris">{t.savedMessage}</span>}
      </div>
    </form>
  );
}
