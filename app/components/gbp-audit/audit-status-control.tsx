"use client";

import { useState, useTransition } from "react";
import { updateAuditStatus } from "@/lib/actions/gbp-audit";
import { getAuditStatusLabel } from "@/lib/gbp-audit/checklist";
import { Select } from "@/components/gbp-audit/ui/field";
import { Badge } from "@/components/crm/badges";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

// Only these two are freely settable from here — see the matching guard in
// lib/actions/gbp-audit.ts. Every other status change goes through the
// gated review workflow (Rapport tab: soumettre / approuver / demander des
// corrections / envoyer), several of which are supervisor-only and stamp
// approval metadata this dropdown must never bypass.
const FREE_STATUS_VALUES = ["not_started", "in_progress"];

export function AuditStatusControl({ auditId, status, locale = "fr" }: { auditId: string; status: string; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.statusControl;
  const statusLabel = getAuditStatusLabel(locale);
  const [current, setCurrent] = useState(status);
  const [isPending, startTransition] = useTransition();

  if (!FREE_STATUS_VALUES.includes(current)) {
    return (
      <div className="flex items-center gap-2">
        <Badge label={statusLabel[current] ?? current} className="bg-pm-gris-2/60 text-pm-gris" />
        <span className="text-xs text-pm-gris">{t.managedFromReportTab}</span>
      </div>
    );
  }

  return (
    <Select
      aria-label={t.ariaLabel}
      value={current}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          try {
            await updateAuditStatus(auditId, next);
            setCurrent(next);
            toast.success(t.updated(statusLabel[next]));
          } catch (err) {
            toast.error(t.updateError, err instanceof Error ? err.message : undefined);
          }
        });
      }}
      className="!w-auto"
    >
      {FREE_STATUS_VALUES.map((value) => (
        <option key={value} value={value}>
          {statusLabel[value]}
        </option>
      ))}
    </Select>
  );
}
