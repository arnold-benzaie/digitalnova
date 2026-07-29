"use client";

import { Toaster } from "sonner";

/**
 * Mounted once in DeveloperPortalProviders — the plain `toast` export from
 * components/gbp-audit/ui/toast.tsx is reused as-is (same sonner-based
 * API, no new toast system per Stage 0 of the developer-platform plan);
 * this only provides a rendering target styled with the semantic tokens
 * (Stage 0's shadcn bridge) instead of the audit module's hardcoded
 * pm-prefixed/white classes, so toasts respect the Developer Platform's
 * dark mode.
 */
export function DeveloperPortalToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border !border-border !bg-card !text-foreground !shadow-lg",
          title: "!text-sm !font-medium",
          description: "!text-xs !text-muted-foreground",
          success: "!border-l-4 !border-l-emerald-500",
          error: "!border-l-4 !border-l-destructive",
          warning: "!border-l-4 !border-l-pm-or",
          info: "!border-l-4 !border-l-foreground",
        },
      }}
    />
  );
}
