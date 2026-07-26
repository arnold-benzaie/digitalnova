"use client";

import { useState, useTransition } from "react";
import { updateBusinessProfileStatus } from "@/lib/actions/gbp-audit";
import { getProfileStatusOptions } from "@/lib/gbp-audit/checklist";
import { Select } from "@/components/gbp-audit/ui/field";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function ProfileStatusControl({ auditId, businessId, status, locale = "fr" }: { auditId: string; businessId: string; status: string; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.profileStatusControl;
  const options = getProfileStatusOptions(locale);
  const [current, setCurrent] = useState(status);
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      aria-label={t.ariaLabel}
      value={current}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value;
        const previous = current;
        setCurrent(next);
        startTransition(async () => {
          try {
            await updateBusinessProfileStatus(auditId, businessId, next);
            toast.success(t.updated);
          } catch (err) {
            setCurrent(previous);
            toast.error(t.updateError, err instanceof Error ? err.message : undefined);
          }
        });
      }}
      className="!w-auto"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
