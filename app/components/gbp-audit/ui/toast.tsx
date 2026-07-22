"use client";

import { Toaster, toast as sonnerToast } from "sonner";

/** Mounted once in app/admin/audit/layout.tsx — styled to match the pm-* tokens instead of sonner's default theme. */
export function AuditToaster() {
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

export const toast = {
  success: (message: string, description?: string) => sonnerToast.success(message, { description }),
  error: (message: string, description?: string) => sonnerToast.error(message, { description }),
  info: (message: string, description?: string) => sonnerToast(message, { description }),
};
