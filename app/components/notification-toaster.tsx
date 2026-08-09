"use client";

import { Toaster, toast as sonnerToast } from "sonner";

/**
 * Mounted once in components/app-shell-client.tsx, which — unlike
 * components/developer-portal/toaster.tsx's genuinely separate module tree
 * — is the SHARED shell for every /admin page, audit module included (see
 * app/admin/layout.tsx -> AppShell -> AppShellClient). sonner's `toast()`
 * is a global singleton: two mounted <Toaster/> instances both render the
 * same call, which is exactly what happened when this coexisted with
 * components/gbp-audit/ui/toast.tsx's AuditToaster (still mounted in
 * app/admin/audit/layout.tsx until this file replaced it) — a single
 * `toast.success(...)` call rendered TWICE on any /admin/audit/* page,
 * caught by e2e/audit-module-coverage.spec.ts's own toast-visibility
 * assertion. This is now the ONE toaster for the whole app (client +
 * staff/admin + audit), so it carries AuditToaster's full success/error/
 * warning styling too — every existing `toast.success()/.error()/.warning()`
 * call elsewhere in the audit module (components/gbp-audit/ui/toast.tsx's
 * own exported `toast` object, still used as-is) keeps rendering exactly
 * as before, just through this single mounted instance instead of two.
 */
export function NotificationToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border !border-pm-gris-2 !bg-white !text-pm-noir !shadow-lg",
          title: "!text-sm !font-medium",
          description: "!text-xs !text-pm-gris",
          success: "!border-l-4 !border-l-emerald-500",
          error: "!border-l-4 !border-l-pm-rouge",
          warning: "!border-l-4 !border-l-pm-or",
          info: "!border-l-4 !border-l-pm-noir",
        },
      }}
    />
  );
}

export const notificationToast = {
  info: (message: string, description?: string) => sonnerToast(message, { description }),
  success: (message: string) => sonnerToast.success(message),
};
