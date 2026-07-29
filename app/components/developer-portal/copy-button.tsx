"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "@/components/gbp-audit/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Shared copy-to-clipboard control (Stage 0) — used by
 * TestResultPanel's payload/header blocks and any future "Copy
 * Secret"/"Copy Key" affordance across the Developer Platform, so the
 * interaction (icon swap + toast) is consistent everywhere instead of
 * re-implemented per screen. Reuses the existing sonner-based `toast`
 * export as-is (see components/gbp-audit/ui/toast.tsx) — no new toast
 * system.
 */
export function CopyButton({
  value,
  label = "Copier",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copié dans le presse-papiers");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Impossible de copier", "Votre navigateur a refusé l'accès au presse-papiers.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
