"use client";

import { toast as sonnerToast } from "sonner";

/**
 * Thin wrapper around sonner's toast() — the actual `<Toaster/>` host that
 * renders these calls is components/notification-toaster.tsx, mounted once
 * in the shared components/app-shell-client.tsx (covers every /admin and
 * /dashboard page, audit module included). This file used to mount its own
 * `<Toaster/>` here too (AuditToaster, scoped to app/admin/audit/layout.tsx);
 * sonner's toast() is a global singleton, so two mounted instances rendered
 * every call twice on audit pages once AppShellClient gained its own — see
 * components/notification-toaster.tsx's header comment for the full story.
 */
export const toast = {
  success: (message: string, description?: string) => sonnerToast.success(message, { description }),
  error: (message: string, description?: string) => sonnerToast.error(message, { description }),
  info: (message: string, description?: string) => sonnerToast(message, { description }),
};
