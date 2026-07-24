"use client";

import { useState, useTransition } from "react";
import { updateBusinessProfileStatus } from "@/lib/actions/gbp-audit";
import { GBP_PROFILE_STATUS_OPTIONS } from "@/lib/gbp-audit/checklist";
import { Select } from "@/components/gbp-audit/ui/field";
import { toast } from "@/components/gbp-audit/ui/toast";

export function ProfileStatusControl({ auditId, businessId, status }: { auditId: string; businessId: string; status: string }) {
  const [current, setCurrent] = useState(status);
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      aria-label="Statut du profil"
      value={current}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value;
        const previous = current;
        setCurrent(next);
        startTransition(async () => {
          try {
            await updateBusinessProfileStatus(auditId, businessId, next);
            toast.success("Statut du profil mis à jour");
          } catch (err) {
            setCurrent(previous);
            toast.error("Impossible de changer le statut du profil", err instanceof Error ? err.message : undefined);
          }
        });
      }}
      className="!w-auto"
    >
      {GBP_PROFILE_STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
